'use strict'

const { WebSocketServer } = require('ws')
const os = require('os')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const favoritesManager = require('./favorites-manager')

/**
 * CompanionServer - Gère la communication WebSocket avec l'application iOS
 */
class CompanionServer extends EventEmitter {
  constructor() {
    super()
    this.wss = null
    this.port = null
    this.clients = new Set()
    
    // Initialisation du statut
    this._refreshStatus()

    // Écouter les mises à jour des favoris/historique pour synchroniser les clients
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
      maintainActive: this.status?.maintainActive || false,
      lastHeartbeat: this.status?.lastHeartbeat || null,
      favorites: favoritesManager.getFavorites(),
      recentHistory: favoritesManager.getHistory()
    }
  }

  /**
   * Démarre le serveur WebSocket
   */
  start(port = 8080) {
    if (this.wss && this.port === port) return
    
    if (this.wss) {
      dbg(`[companion-server] Changement de port ${this.port} -> ${port}`)
      this.stop()
    }

    try {
      this.port = port
      this.wss = new WebSocketServer({ port })
      const ip = this._getLocalIp()
      dbg(`[companion-server] Serveur démarré sur ${ip}:${port}`)
      sendStatus('companion', 'info', `Prêt pour connexion iPhone sur ${ip}:${port}`)

      this.wss.on('connection', (ws, req) => {
        let clientIp = req.socket.remoteAddress
        if (clientIp.startsWith('::ffff:')) clientIp = clientIp.substring(7)
        
        dbg(`[companion-server] Nouveau client connecté : ${clientIp}`)
        this.emit('iphone-ip-detected', clientIp)
        
        this.clients.add(ws)
        ws.send(JSON.stringify({ type: 'STATUS', data: this.status }))

        ws.on('message', (message) => {
          try {
            const payload = JSON.parse(message)
            this._handleMessage(ws, payload)
          } catch (e) {
            dbg(`[companion-server] Erreur message: ${e.message}`)
          }
        })

        ws.on('close', () => {
          dbg('[companion-server] Client déconnecté')
          this.clients.delete(ws)
          this._checkActivity()
        })

        ws.on('error', (err) => {
          dbg(`[companion-server] Erreur client: ${err.message}`)
          this.clients.delete(ws)
        })
      })
    } catch (e) {
      dbg(`[companion-server] Erreur démarrage sur port ${port}: ${e.message}`)
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
      port: this.port,
      url: `ws://${this._getLocalIp()}:${this.port}`
    }
  }

  _handleMessage(ws, payload) {
    switch (payload.type) {
      case 'HEARTBEAT':
        this.status.maintainActive = payload.data.isMaintaining
        this.status.lastHeartbeat = Date.now()
        this._updateFrontend()
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }))
        break
      
      case 'SET_LOCATION':
        const { lat, lon, name } = payload.data
        dbg(`[companion-server] iPhone demande position: ${lat}, ${lon} (${name})`)
        this.emit('request-location', { lat, lon, name })
        if (name) favoritesManager.addToHistory({ lat, lon, name })
        break
      
      case 'ADD_HISTORY':
        favoritesManager.addToHistory(payload.data)
        break
      
      case 'ADD_FAVORITE':
        favoritesManager.addFavorite(payload.data)
        break
      
      case 'REMOVE_FAVORITE':
        favoritesManager.removeFavorite(payload.data.lat, payload.data.lon)
        break
      
      case 'RENAME_FAVORITE':
        favoritesManager.renameFavorite(payload.data.lat, payload.data.lon, payload.data.newName)
        break
      
      case 'CLIENT_LOG':
        this.emit('client-log', payload.data)
        break
    }
  }

  // Façades pour appeler la logique métier via le dashboard (ou autres)
  addFavorite(fav) { return favoritesManager.addFavorite(fav) }
  removeFavorite(lat, lon) { return favoritesManager.removeFavorite(lat, lon) }
  renameFavorite(lat, lon, newName) { return favoritesManager.renameFavorite(lat, lon, newName) }

  stop() {
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
  }

  _broadcast(data) {
    const message = JSON.stringify(data)
    for (const client of this.clients) {
      if (client.readyState === 1) client.send(message)
    }
  }

  _updateFrontend() {
    if (this.status.maintainActive) {
      sendStatus('companion', 'ready', 'iPhone connect\u00e9 & actif')
    } else {
      sendStatus('companion', 'info', 'iPhone connect\u00e9 (en attente)')
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

module.exports = new CompanionServer()
