'use strict'

/**
 * tunneld-manager.js (L'Orchestrateur Maître - Version Landsat 9)
 * Gère la hiérarchie : USB > Bonjour > TunnelId
 * Utilise TunneldDaemon pour éviter les conflits de ports.
 */

const { dbg, sendStatus } = require('./logger')
const wifiConnector = require('./services/connectors/wifi-connector')
const tunneldDaemon = require('./services/tunneld-daemon')
const gpsBridge = require('./services/gps/gps-bridge')
const { PYTHON } = require('./python-resolver')
const ProcessRunner = require('./utils/process-runner')
const { EventEmitter } = require('events')

class ConnectionOrchestrator extends EventEmitter {
  constructor() {
    super()
    this.wifi = wifiConnector
    this.daemon = tunneldDaemon
    
    this.activeConnection = null
    this.heartbeatRunners = new Map()
    this._isQuitting = false
    this._onTunnelRestoredCb = null
    this._onStatusChangeCb = null

    this._initListeners()
  }

  _initListeners() {
    // Événements du Démon (USB & TunnelId)
    this.daemon.on('connection', (conn) => {
      // Priorité 1 : USB
      if (conn.type === 'USB') {
        dbg('[orchestrator] Priorite USB detectee via Demon')
        this._handleNewConnection(conn)
      } 
      // Priorité 3 : TunnelId (uniquement si rien d'autre)
      else if (!this.activeConnection) {
        dbg('[orchestrator] Fallback TunnelId detecte via Demon')
        this._handleNewConnection(conn)
      }
    })

    this.daemon.on('disconnection', () => this._handleDisconnection('Demon'))

    // Événements WiFi Bonjour (Priorité 2)
    this.wifi.on('connection', (conn) => {
      if (this.activeConnection?.type === 'USB') return
      dbg('[orchestrator] Connexion WiFi (Bonjour) detectee')
      this._handleNewConnection(conn)
    })

    this.wifi.on('disconnection', () => this._handleDisconnection('WiFi'))
  }

  _handleNewConnection(conn) {
    if (this.activeConnection?.address === conn.address && this.activeConnection?.port === conn.port) return

    this.activeConnection = conn
    dbg(`[orchestrator] Nouvelle connexion active : ${conn.type} (${conn.address}:${conn.port})`)

    sendStatus({
      service: 'tunneld',
      state: 'ready',
      message: `Connecté via ${conn.type}`,
      type: conn.type,
      device: conn.deviceInfo || { name: 'iPhone' }
    })

    this._startHeartbeat(conn.address, conn.port)
    
    if (this._onTunnelRestoredCb) this._onTunnelRestoredCb()
    if (this._onStatusChangeCb) this._onStatusChangeCb(true)
    this.emit('ready', conn)
  }

  _handleDisconnection(source) {
    if (!this.activeConnection) return
    
    dbg(`[orchestrator] Deconnexion detectee via ${source}`)
    this.activeConnection = null
    this._stopAllHeartbeats()
    
    sendStatus({
      service: 'tunneld',
      state: 'scanning',
      message: 'Connexion perdue, recherche...'
    })

    if (this._onStatusChangeCb) this._onStatusChangeCb(false)
    this.emit('lost')
  }

  start() {
    if (this._isQuitting) return
    dbg('[orchestrator] Demarrage du moteur de decouverte...')
    
    this.daemon.start()
    this.wifi.start()

    sendStatus({
      service: 'tunneld',
      state: 'scanning',
      message: 'Recherche d\'un iPhone...'
    })
  }

  _startHeartbeat(address, port) {
    this._stopAllHeartbeats()
    
    dbg(`[orchestrator] Battement de coeur (Bridge) sur ${address}:${port}...`)
    
    // On lance une boucle de heartbeat via le pont
    const hbInterval = setInterval(async () => {
      if (!this.activeConnection || this.activeConnection.address !== address) {
        clearInterval(hbInterval)
        return
      }

      const result = await gpsBridge.sendCommand('heartbeat', address, port)
      if (!result.success) {
        dbg(`[orchestrator] Echec heartbeat pont : ${result.error}`)
      }
    }, 10000)

    this.heartbeatRunners.set('active', { stop: () => clearInterval(hbInterval) })
  }

  _stopAllHeartbeats() {
    for (const hb of this.heartbeatRunners.values()) {
      hb.stop()
    }
    this.heartbeatRunners.clear()
  }

  stopTunneld() {
    this.daemon.stop()
    this.wifi.stop()
    this._stopAllHeartbeats()
    this.activeConnection = null
  }

  setQuitting() {
    this._isQuitting = true
    this.stopTunneld()
  }

  // API Façade
  getRsdAddress() { return this.activeConnection?.address }
  getRsdPort() { return this.activeConnection?.port }
  getConnectionType() { return this.activeConnection?.type }
  getDeviceInfo() { return this.activeConnection?.deviceInfo || { name: 'iPhone', version: 'Inconnue' } }
  
  forceRefresh() { this.stopTunneld(); this.start() }
  startTunneld() { this.start() }
  applyConnectionMode(mode) { dbg(`[orchestrator] Mode : ${mode} (Auto)`) }
  setWifiIpOverride(ip) { dbg(`[orchestrator] IP Info : ${ip}`) }
  setOnTunnelRestored(cb) { this._onTunnelRestoredCb = cb }
  setOnStatusChange(cb) { this._onStatusChangeCb = cb }
}

module.exports = new ConnectionOrchestrator()
