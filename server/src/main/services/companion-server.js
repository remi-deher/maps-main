'use strict'

const { WebSocketServer } = require('ws')
const os = require('os')
const { dbg, sendStatus } = require('../logger')

/**
 * CompanionServer - Gère la communication WebSocket avec l'application iOS
 */
class CompanionServer {
  constructor() {
    this.wss = null
    this.clients = new Set()
    this.status = {
      tunnelActive: false,
      maintainActive: false,
      lastHeartbeat: null
    }
  }

  /**
   * Démarre le serveur WebSocket
   */
  start(port = 8080) {
    if (this.wss) return
    
    try {
      this.wss = new WebSocketServer({ port })
      const ip = this._getLocalIp()
      dbg(`[companion-server] Serveur démarré sur ${ip}:${port}`)
      sendStatus('companion', 'info', `Prêt pour connexion iPhone sur ${ip}`)

      this.wss.on('connection', (ws) => {
        dbg('[companion-server] Nouveau client connecté (iPhone)')
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
          if (this.clients.size === 0) {
            this.status.maintainActive = false
            this._updateFrontend()
          }
        })
      })
    } catch (e) {
      dbg(`[companion-server] Erreur démarrage: ${e.message}`)
      sendStatus('companion', 'error', `Erreur serveur compagnon : ${e.message}`)
    }
  }

  /**
   * Met à jour le statut du tunnel et informe les clients iOS
   */
  updateTunnelStatus(active) {
    this.status.tunnelActive = active
    this._broadcast({ type: 'STATUS', data: this.status })
  }

  _handleMessage(ws, payload) {
    if (payload.type === 'HEARTBEAT') {
      const prevMaintain = this.status.maintainActive
      this.status.maintainActive = payload.data.isMaintaining
      this.status.lastHeartbeat = Date.now()
      
      if (prevMaintain !== this.status.maintainActive) {
        this._updateFrontend()
      }
      
      // Répondre au heartbeat
      ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }))
    }
  }

  _broadcast(data) {
    const message = JSON.stringify(data)
    for (const client of this.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(message)
      }
    }
  }

  _updateFrontend() {
    const label = this.status.maintainActive ? 'ACTIF (iPhone)' : 'INACTIF'
    const statusType = this.status.maintainActive ? 'ready' : 'info'
    sendStatus('companion', statusType, `Maintenance iOS : ${label}`)
  }

  _getLocalIp() {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address
        }
      }
    }
    return '127.0.0.1'
  }

  stop() {
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
  }
}

module.exports = new CompanionServer()
