'use strict'

/**
 * tunneld-manager.js (L'Orchestrateur Maître - Version go-ios)
 * Gère la connexion via go-ios et son API REST locale.
 */

const { dbg, sendStatus } = require('./logger')
const goIosService = require('./tunneld/tunneld-service')
const pmd3Service = require('./services/tunneld-daemon')
const gpsBridge = require('./services/gps/gps-bridge')
const settings = require('./services/settings-manager')
const { EventEmitter } = require('events')

class ConnectionOrchestrator extends EventEmitter {
  constructor() {
    super()
    this.daemons = {
      'go-ios': goIosService,
      'pymobiledevice': pmd3Service
    }
    
    this.activeConnection = null
    this.heartbeatRunners = new Map()
    this.isCompanionConnected = false
    this.companionIp = null
    this._isQuitting = false
    
    this._onStatusChangeCb = null

    this._initListeners()
  }

  _initListeners() {
    // Écouter go-ios
    goIosService.on('connection', (conn) => {
      this._onDaemonConnection('go-ios', conn)
    })
    goIosService.on('disconnection', () => {
      this._onDaemonDisconnection('go-ios')
    })

    // Écouter PMD3
    pmd3Service.on('connection', (conn) => {
      this._onDaemonConnection('pymobiledevice', conn)
    })
    pmd3Service.on('disconnection', () => {
      this._onDaemonDisconnection('pymobiledevice')
    })
  }

  _onDaemonConnection(driver, conn) {
    const currentSettings = settings.get()
    const connType = conn.type?.toUpperCase().includes('WIFI') ? 'WIFI' : 'USB'
    const preferredDriver = connType === 'WIFI' ? currentSettings.wifiDriver : currentSettings.usbDriver

    dbg(`[orchestrator] Tentative de connexion via ${driver} (${connType}) - Préférence: ${preferredDriver}`)

    // Si on a déjà une connexion active, on ne change que si le driver entrant est "mieux" (préféré)
    // ou si la connexion actuelle est du même type et même driver.
    if (this.activeConnection) {
      if (this.activeConnection.driver === preferredDriver && driver !== preferredDriver) {
        dbg(`[orchestrator] Ignoré: On a déjà une connexion via le driver préféré ${preferredDriver}`)
        return
      }
      // Si on bascule vers un driver préféré
      if (driver === preferredDriver && this.activeConnection.driver !== preferredDriver) {
        dbg(`[orchestrator] Basculement vers le driver préféré : ${driver}`)
      } else if (this.activeConnection.address === conn.address && this.activeConnection.port === conn.port) {
        return // Même connexion
      }
    }

    conn.driver = driver
    this._handleNewConnection(conn)
  }

  _onDaemonDisconnection(driver) {
    if (this.activeConnection && this.activeConnection.driver === driver) {
      dbg(`[orchestrator] Déconnexion détectée du driver actif : ${driver}`)
      this._handleDisconnection()
    }
  }

  handleIphoneIpDetected(ip) {
    dbg(`[orchestrator] Hint WebSocket reçu (${ip}).`)
    this.isCompanionConnected = true
    this.companionIp = ip
    
    if (this.activeConnection) {
      this._startHeartbeatCycle()
    }
  }

  _handleNewConnection(conn) {
    this.activeConnection = conn
    const driverName = conn.driver === 'go-ios' ? 'go-ios' : 'PMD3'
    const typeLabel = conn.type || 'USB'
    
    dbg(`[orchestrator] ✅ Connexion active : ${conn.address}:${conn.port} via ${driverName} (${typeLabel})`)

    sendStatus('tunneld', 'ready', `Connecté via ${typeLabel} (${driverName})`, {
      type: typeLabel,
      driver: conn.driver,
      device: conn.deviceInfo || { name: 'iPhone' }
    })

    if (this.isCompanionConnected) {
      this._startHeartbeatCycle()
    }

    if (this._onStatusChangeCb) this._onStatusChangeCb(true)
    this.emit('ready', conn)
  }

  _startHeartbeatCycle() {
    this._stopAllHeartbeats()
    if (!this.activeConnection) return
    
    const driver = this.activeConnection.driver
    dbg(`[orchestrator] Lancement du cycle Heartbeat (${driver})...`)
    
    const hbInterval = setInterval(async () => {
      if (!this.activeConnection) {
        clearInterval(hbInterval)
        return
      }
      const result = await gpsBridge.sendCommand('heartbeat')
      if (!result.success) {
        dbg(`[orchestrator] Heartbeat ${driver} échoué`)
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
    Object.values(this.daemons).forEach(d => {
      if (d.stopHeartbeats) d.stopHeartbeats()
    })
    for (const hb of this.heartbeatRunners.values()) {
      hb.stop()
    }
    this.heartbeatRunners.clear()
  }

  start() {
    if (this._isQuitting) return
    const s = settings.get()
    
    dbg(`[orchestrator] Démarrage des services (USB: ${s.usbDriver}, WiFi: ${s.wifiDriver})...`)
    
    gpsBridge.start()

    // Démarrer les daemons nécessaires
    const needed = new Set([s.usbDriver, s.wifiDriver])
    needed.forEach(driverId => {
      const daemon = this.daemons[driverId]
      if (daemon) {
        dbg(`[orchestrator] Lancement du driver : ${driverId}`)
        daemon.start()
      }
    })

    sendStatus('tunneld', 'scanning', `Recherche iPhone (USB:${s.usbDriver} WiFi:${s.wifiDriver})...`)
  }

  stopTunneld() {
    Object.values(this.daemons).forEach(d => d.stop())
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
  getConnectionType() { return this.activeConnection?.type || 'USB' }
  getActiveDriver() { return this.activeConnection?.driver }
  getDeviceInfo() { return this.activeConnection?.deviceInfo || { name: 'iPhone', version: 'Inconnue' } }
  
  isStarting() { 
    return Object.values(this.daemons).some(d => d._isStarting || (d.runner && d.runner.isRunning)) 
  }
  
  forceRefresh() { 
    dbg('[orchestrator] 🔄 Redémarrage complet des tunnels...')
    this.stopTunneld()
    setTimeout(() => this.start(), 1000)
  }

  startTunneld() { this.start() }
  
  applySettings() {
    dbg('[orchestrator] Application des nouveaux paramètres...')
    this.forceRefresh()
  }

  applyConnectionMode(mode) { 
    // Maintenu pour compatibilité, mais applySettings est préféré
    this.applySettings()
  }

  setWifiIpOverride(ip) { this.handleIphoneIpDetected(ip) }
  setOnStatusChange(cb) { this._onStatusChangeCb = cb }
}

module.exports = new ConnectionOrchestrator()

