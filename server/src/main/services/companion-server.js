'use strict'

const WebSocket = require('ws')
const { WebSocketServer } = WebSocket
const os = require('os')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const favoritesManager = require('./favorites-manager')

/**
 * CompanionServer - Gere la communication WebSocket avec l'application iOS
 */
class CompanionServer extends EventEmitter {
  constructor(tunnelManager) {
    super()
    this.tunnel = tunnelManager
    this.wss = null
    this.port = null
    this.clients = new Set()
    this.status = {}
    
    // Initialisation du statut
    this._refreshStatus()

    // Ecouter les mises a jour des favoris/historique pour synchroniser les clients
    favoritesManager.on('favorites-updated', (favs) => {
      this.status.favorites = favs
      this._broadcast({ type: 'STATUS', data: this.status })
      this.emit('favorites-updated', favs)
    })

    favoritesManager.on('history-updated', (history) => {
      this.status.recentHistory = history
      this._broadcast({ type: 'STATUS', data: this.status })
      this.emit('history-updated', history)
    })
  }

  _refreshStatus() {
    this.status = {
      tunnelActive: this.status?.tunnelActive || false,
      rsdAddress: this.tunnel?.getRsdAddress() || null,
      rsdPort: this.tunnel?.getRsdPort() || null,
      connectionType: this.tunnel?.getConnectionType() || null,
      deviceInfo: this.tunnel?.getDeviceInfo() || null,
      maintainActive: this.status?.maintainActive || false,
      lastHeartbeat: this.status?.lastHeartbeat || null,
      favorites: favoritesManager.getFavorites(),
      recentHistory: favoritesManager.getHistory()
    }
  }

  /**
   * Demarre le serveur WebSocket
   */
  start(port = 8080) {
    if (this.wss && this.port === port) {
      dbg(`[companion-server] Serveur deja actif sur le port ${port}`)
      return
    }
    
    if (this.wss) {
      dbg(`[companion-server] Changement de port ${this.port} -> ${port}`)
      this.stop()
    }

    try {
      this.port = port
      this.wss = new WebSocketServer({ port })
      const ip = this._getLocalIp()
      dbg(`[companion-server] Serveur demarre sur ${ip}:${port}`)
      sendStatus('companion', 'info', `Pret pour connexion iPhone sur ${ip}:${port}`)

      this.wss.on('connection', (ws, req) => {
        let clientIp = req.socket.remoteAddress
        if (clientIp.startsWith('::ffff:')) clientIp = clientIp.substring(7)
        
        dbg(`[companion-server] Nouveau client connecte : ${clientIp}`)
        this.emit('iphone-ip-detected', clientIp)
        
        this.clients.add(ws)
        ws.send(JSON.stringify({ type: 'STATUS', data: this.status }))

        ws.on('message', (message) => {
          try {
            const payload = JSON.parse(message)
            if (payload && payload.type) {
              this._handleMessage(ws, payload)
            }
          } catch (e) {
            dbg(`[companion-server] Erreur traitement message: ${e.message}`)
          }
        })

        ws.on('close', () => {
          dbg('[companion-server] Client deconnecte')
          this.clients.delete(ws)
          this._checkActivity()
        })

        ws.on('error', (err) => {
          dbg(`[companion-server] Erreur client: ${err.message}`)
          this.clients.delete(ws)
        })
      })

      this.wss.on('error', (err) => {
        dbg(`[companion-server] Erreur CRITIQUE serveur: ${err.message}`)
        sendStatus('companion', 'error', `Erreur serveur : ${err.message}`)
      })

    } catch (e) {
      dbg(`[companion-server] Erreur demarrage sur port ${port}: ${e.message}`)
      sendStatus('companion', 'error', `Erreur serveur compagnon : ${e.message}`)
    }
  }

  updateTunnelStatus(active) {
    this.status.tunnelActive = active
    this._broadcast({ type: 'STATUS', data: this.status })
    this._updateFrontend()
  }

  broadcastLocation(lat, lon, name = '') {
    this._broadcast({ 
      type: 'LOCATION', 
      data: { lat, lon, name } 
    })
  }

  getConnectionInfo() {
    return {
      ip: this._getLocalIp(),
      port: this.port || 8080,
      url: `ws://${this._getLocalIp()}:${this.port || 8080}`
    }
  }

  _handleMessage(ws, payload) {
    switch (payload.type) {
      case 'HEARTBEAT': {
        if (payload.data) {
          this.status.maintainActive = payload.data.isMaintaining || false
        }
        this.status.lastHeartbeat = Date.now()
        this._updateFrontend()
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }))
        break
      }
      
      case 'SET_LOCATION': {
        const { lat, lon, name } = payload.data || {}
        if (lat && lon) {
          dbg(`[companion-server] iPhone demande position: ${lat}, ${lon} (${name || 'sans nom'})`)
          this.emit('request-location', { lat, lon, name })
          if (name) favoritesManager.addToHistory({ lat, lon, name })
        }
        break
      }
      
      case 'ADD_HISTORY': {
        if (payload.data) favoritesManager.addToHistory(payload.data)
        break
      }
      
      case 'ADD_FAVORITE': {
        if (payload.data) favoritesManager.addFavorite(payload.data)
        break
      }
      
      case 'REMOVE_FAVORITE': {
        if (payload.data) favoritesManager.removeFavorite(payload.data.lat, payload.data.lon)
        break
      }
      
      case 'RENAME_FAVORITE': {
        if (payload.data) favoritesManager.renameFavorite(payload.data.lat, payload.data.lon, payload.data.newName)
        break
      }
      
      case 'CLIENT_LOG': {
        this.emit('client-log', payload.data)
        break
      }
    }
  }

  // Facades pour appeler la logique metier via le dashboard (ou autres)
  addFavorite(fav) { return favoritesManager.addFavorite(fav) }
  removeFavorite(lat, lon) { return favoritesManager.removeFavorite(lat, lon) }
  renameFavorite(lat, lon, newName) { return favoritesManager.renameFavorite(lat, lon, newName) }

  stop() {
    if (this.wss) {
      dbg('[companion-server] Arret du serveur WebSocket...')
      this.wss.close()
      this.wss = null
    }
  }

  _broadcast(data) {
    if (!this.wss) return
    const message = JSON.stringify(data)
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  }

  _updateFrontend() {
    if (this.clients.size > 0) {
      if (this.status.maintainActive) {
        sendStatus('companion', 'ready', 'iPhone connecte & actif')
      } else {
        sendStatus('companion', 'info', 'iPhone connecte (en attente)')
      }
    } else {
      sendStatus('companion', 'info', 'En attente de connexion iPhone...')
    }
  }

  _checkActivity() {
    if (this.clients.size === 0) {
      this.status.maintainActive = false
      this._updateFrontend()
    }
  }

  _getLocalIp() {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address
      }
    }
    return '127.0.0.1'
  }
}

module.exports = CompanionServer
