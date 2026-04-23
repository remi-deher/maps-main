'use strict'

const { WebSocketServer } = require('ws')
const os = require('os')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const settings = require('./settings-manager')

/**
 * CompanionServer - Gère la communication WebSocket avec l'application iOS
 */
class CompanionServer extends EventEmitter {
  constructor() {
    super()
    this.wss = null
    this.port = null
    this.clients = new Set()
    this.status = {
      tunnelActive: false,
      maintainActive: false,
      lastHeartbeat: null,
      favorites: settings.get('favorites') || [],
      recentHistory: settings.get('recentHistory') || []
    }
  }

  /**
   * Démarre le serveur WebSocket
   */
  start(port = 8080) {
    // Si le serveur tourne déjà sur le même port, on ne fait rien
    if (this.wss && this.port === port) return
    
    // Si on change de port, on ferme l'ancien
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

        // Envoyer l'état actuel au nouveau client
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

  /**
   * Met à jour le statut du tunnel et informe les clients iOS
   */
  updateTunnelStatus(active) {
    this.status.tunnelActive = active
    this._broadcast({ type: 'STATUS', data: this.status })
    this._updateFrontend()
  }

  /**
   * Envoie la position simulée actuelle aux clients connectés
   */
  broadcastLocation(lat, lon, name = '') {
    this._broadcast({ 
      type: 'LOCATION', 
      data: { lat, lon, name } 
    })
  }

  /**
   * Retourne l'URL de connexion WebSocket pour le QR Code
   */
  getConnectionInfo() {
    return {
      ip: this._getLocalIp(),
      port: this.port,
      url: `ws://${this._getLocalIp()}:${this.port}`
    }
  }

  _handleMessage(ws, payload) {
    if (payload.type === 'HEARTBEAT') {
      this.status.maintainActive = payload.data.isMaintaining
      this.status.lastHeartbeat = Date.now()
      this._updateFrontend()
      
      // Répondre au heartbeat
      ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }))
    } 
    else if (payload.type === 'SET_LOCATION') {
      const { lat, lon, name } = payload.data
      dbg(`[companion-server] iPhone demande position: ${lat}, ${lon} (${name})`)
      this.emit('request-location', { lat, lon, name })
      
      // Ajouter automatiquement à l'historique si un nom est présent
      if (name) {
        this._addToHistory({ lat, lon, name })
      }
    }
    else if (payload.type === 'ADD_HISTORY') {
      this._addToHistory(payload.data)
    }
    else if (payload.type === 'ADD_FAVORITE') {
      this.addFavorite(payload.data)
    }
    else if (payload.type === 'REMOVE_FAVORITE') {
      this.removeFavorite(payload.data.lat, payload.data.lon)
    }
    else if (payload.type === 'RENAME_FAVORITE') {
      this.renameFavorite(payload.data.lat, payload.data.lon, payload.data.newName)
    }
    else if (payload.type === 'CLIENT_LOG') {
      this.emit('client-log', payload.data);
    }
  }

  addFavorite(fav) {
    let favs = settings.get('favorites') || [];
    // Éviter les doublons par coordonnées
    if (!favs.some(f => Math.abs(f.lat - fav.lat) < 0.0001 && Math.abs(f.lon - fav.lon) < 0.0001)) {
      favs = [fav, ...favs];
      settings.save({ favorites: favs });
      this.status.favorites = favs;
      this._broadcast({ type: 'STATUS', data: this.status });
      this.emit('favorites-updated', favs);
    }
  }

  removeFavorite(lat, lon) {
    let favs = settings.get('favorites') || [];
    const newFavs = favs.filter(f => Math.abs(f.lat - lat) > 0.0001 || Math.abs(f.lon - lon) > 0.0001);
    if (newFavs.length !== favs.length) {
      settings.save({ favorites: newFavs });
      this.status.favorites = newFavs;
      this._broadcast({ type: 'STATUS', data: this.status });
      this.emit('favorites-updated', newFavs);
    }
  }

  renameFavorite(lat, lon, newName) {
    let favs = settings.get('favorites') || [];
    favs = favs.map(f => {
      if (Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001) {
        return { ...f, name: newName };
      }
      return f;
    });
    settings.save({ favorites: favs });
    this.status.favorites = favs;
    this._broadcast({ type: 'STATUS', data: this.status });
    this.emit('favorites-updated', favs);
  }

  _addToHistory(entry) {
    let history = settings.get('recentHistory') || []
    // Éviter les doublons consécutifs ou trop proches
    if (history.length > 0 && history[0].name === entry.name) return

    history = [entry, ...history].slice(0, 20) // Garder les 20 derniers
    settings.save({ recentHistory: history })
    this.status.recentHistory = history
    this._broadcast({ type: 'STATUS', data: this.status })
    this.emit('history-updated', history)
  }

  _broadcast(data) {
    const message = JSON.stringify(data)
    for (const client of this.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(message)
      }
    }
  }

  _checkActivity() {
    if (this.clients.size === 0) {
      this.status.maintainActive = false
      this.status.lastHeartbeat = null
      this._updateFrontend()
    }
  }

  _updateFrontend() {
    const count = this.clients.size
    if (count === 0) {
      sendStatus('companion', 'stopped', 'iPhone déconnecté')
      return
    }

    const label = this.status.maintainActive ? 'MAINTENANCE ACTIVE' : 'CONNECTÉ'
    const state = this.status.maintainActive ? 'ready' : 'starting'
    sendStatus('companion', state, `iPhone ${label} (${count})`)
  }

  _getLocalIp() {
    // Priorité à l'IP forcée dans les réglages
    const manualIp = settings.get('wifiIp')
    if (manualIp) return manualIp

    const interfaces = os.networkInterfaces()
    let fallbackIp = '127.0.0.1'
    
    // On parcourt les interfaces par ordre de probabilité
    for (const name of Object.keys(interfaces)) {
      const lowerName = name.toLowerCase()
      
      // Ignorer les interfaces virtuelles connues
      if (lowerName.includes('virtualbox') || 
          lowerName.includes('vmware') || 
          lowerName.includes('vbox') || 
          lowerName.includes('vethernet') || 
          lowerName.includes('wsl')) {
        continue
      }

      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          // Si on trouve une IP qui ressemble à une IP locale standard, on la prend direct
          if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
            return iface.address
          }
          fallbackIp = iface.address
        }
      }
    }
    return fallbackIp
  }

  stop() {
    if (this.wss) {
      dbg(`[companion-server] Arrêt du serveur sur port ${this.port}`)
      this.wss.close()
      this.wss = null
      this.clients.clear()
    }
  }
}

module.exports = new CompanionServer()
