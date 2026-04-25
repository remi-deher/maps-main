'use strict'

/**
 * tunneld-manager.js (L'Orchestrateur Maître - Version go-ios)
 * Gère la connexion via go-ios et son API REST locale.
 */

const { dbg, sendStatus } = require('./logger')
const tunneldService = require('./tunneld/tunneld-service')
const gpsBridge = require('./services/gps/gps-bridge')
const { EventEmitter } = require('events')

class ConnectionOrchestrator extends EventEmitter {
  constructor() {
    super()
    this.daemon = tunneldService
    
    this.activeConnection = null
    this.heartbeatRunners = new Map()
    this.isCompanionConnected = false
    this.companionIp = null
    this._isQuitting = false
    
    this._onStatusChangeCb = null

    this._initListeners()
  }

  _initListeners() {
    this.daemon.on('connection', (conn) => {
      dbg(`[orchestrator] Connexion go-ios établie : ${conn.address}:${conn.port}`)
      this._handleNewConnection(conn)
    })

    this.daemon.on('disconnection', () => {
      dbg('[orchestrator] Déconnexion détectée du tunnel go-ios.')
      this._handleDisconnection()
    })
  }

  /**
   * Hint WebSocket : IP Certifiée reçue du compagnon iOS.
   */
  handleIphoneIpDetected(ip) {
    dbg(`[orchestrator] Hint WebSocket reçu (${ip}).`)
    this.isCompanionConnected = true
    this.companionIp = ip
    
    if (this.activeConnection) {
      this._startHeartbeatCycle()
    }
  }

  _handleNewConnection(conn) {
    if (this.activeConnection?.address === conn.address && this.activeConnection?.port === conn.port) return

    this.activeConnection = conn
    dbg(`[orchestrator] Connexion active : ${conn.address}:${conn.port} (UDID: ${conn.id.slice(0, 8)})`)

    sendStatus('tunneld', 'ready', `Connecté via USB (go-ios)`, {
      type: 'USB',
      device: conn.deviceInfo || { name: 'iPhone' }
    })

    // On lance le heartbeat si le compagnon est là
    if (this.isCompanionConnected) {
      this._startHeartbeatCycle()
    }

    if (this._onStatusChangeCb) this._onStatusChangeCb(true)
    this.emit('ready', conn)
  }

  _startHeartbeatCycle() {
    this._stopAllHeartbeats()
    if (!this.activeConnection) return
    
    dbg(`[orchestrator] Lancement du cycle Heartbeat (API REST)...`)
    
    const hbInterval = setInterval(async () => {
      if (!this.activeConnection) {
        clearInterval(hbInterval)
        return
      }

      // Heartbeat via l'API REST de go-ios
      const result = await gpsBridge.sendCommand('heartbeat')
      if (!result.success) {
        dbg(`[orchestrator] Heartbeat API échoué`)
      }
    }, 15000)

    this.heartbeatRunners.set('active', { stop: () => clearInterval(hbInterval) })
  }

  _handleDisconnection() {
    if (!this.activeConnection) return
    
    dbg('[orchestrator] Tunnel perdu')
    this.activeConnection = null
    this._stopAllHeartbeats()
    
    sendStatus('tunneld', 'scanning', 'Connexion perdue, recherche...')

    if (this._onStatusChangeCb) this._onStatusChangeCb(false)
    this.emit('lost')
  }

  _stopAllHeartbeats() {
    this.daemon.stopHeartbeats()
    for (const hb of this.heartbeatRunners.values()) {
      hb.stop()
    }
    this.heartbeatRunners.clear()
  }

  /**
   * Démarre les services
   */
  start() {
    if (this._isQuitting) return
    dbg('[orchestrator] Démarrage des services go-ios...')
    
    gpsBridge.start()
    this.daemon.start()

    sendStatus('tunneld', 'scanning', 'Recherche d\'un iPhone via go-ios...')
  }

  stopTunneld() {
    this.daemon.stop()
    this._stopAllHeartbeats()
    this.activeConnection = null
  }

  setQuitting() {
    this._isQuitting = true
    this.stopTunneld()
  }

  // API Publique (Façade)
  getRsdAddress() { return this.activeConnection?.address }
  getRsdPort() { return this.activeConnection?.port }
  getConnectionType() { return 'USB' }
  getDeviceInfo() { return this.activeConnection?.deviceInfo || { name: 'iPhone', version: 'Inconnue' } }
  
  forceRefresh() { 
    dbg('[orchestrator] 🔄 Redémarrage du tunnel go-ios...')
    this.stopTunneld()
    this.start() 
  }

  startTunneld() { this.start() }
  applyConnectionMode(mode) { dbg(`[orchestrator] Mode demandé : ${mode}`) }
  setWifiIpOverride(ip) { this.handleIphoneIpDetected(ip) }
  setOnStatusChange(cb) { this._onStatusChangeCb = cb }
}

module.exports = new ConnectionOrchestrator()
