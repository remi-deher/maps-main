'use strict'

const { dbg, sendStatus } = require('./logger')
const gpsBridge = require('./services/gps/gps-bridge')
const settings = require('./services/settings-manager')
const { EventEmitter } = require('events')

// Nouveaux Drivers
const Pmd3Driver = require('./services/drivers/Pmd3Driver')
const GoIosDriver = require('./services/drivers/GoIosDriver')

class ConnectionOrchestrator extends EventEmitter {
  constructor() {
    super()
    this.drivers = {
      'pymobiledevice': new Pmd3Driver(),
      'go-ios': new GoIosDriver()
    }
    
    this.activeConnection = null
    this.activeDriverId = null
    this.heartbeatRunners = new Map()
    this.isCompanionConnected = false
    this.companionIp = null
    this._isQuitting = false
    this.healthCheckInterval = null
    this._reconnectTimer = null
    this._consecutiveHealthFailures = 0

    this._initListeners()
    this._startHealthCheck()
    this._setupAutoReconnect()
  }

  _startHealthCheck() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval)
    this.healthCheckInterval = setInterval(async () => {
      const s = settings.get()
      if (s.manualTunnelMode) return

      const activeDriver = this.drivers[this.activeDriverId]
      if (activeDriver && activeDriver.isActive && !this.isStarting()) {
        const isHealthy = await activeDriver.checkHealth()
        if (!isHealthy) {
          this._consecutiveHealthFailures++
          dbg(`[orchestrator] 🩺 Alerte santé (Échec ${this._consecutiveHealthFailures}/2) sur ${this.activeDriverId}`)
          
          if (this._consecutiveHealthFailures >= 2) {
            dbg(`[orchestrator] 🚨 Driver ${this.activeDriverId} corrompu. Redémarrage forcé...`)
            this.forceRefresh()
            this._consecutiveHealthFailures = 0
          }
        } else {
          this._consecutiveHealthFailures = 0
        }
      }
    }, 10000)
  }

  _setupAutoReconnect() {
    // Si le driver émet une déconnexion, on tente de reconnecter
    this.on('lost', () => {
      const s = settings.get()
      if (this._reconnectTimer || this._isQuitting || s.manualTunnelMode) return
      
      const interval = 3000 // Reconnexion agressive (3s)
      dbg(`[orchestrator] 🔄 Perte de connexion. Tentative de reconnexion agressive toutes les ${interval/1000}s...`)
      
      this._reconnectTimer = setInterval(() => {
        if (!this.activeDriverId && !this.isStarting() && !this._isQuitting) {
          this.start()
        } else if (this.activeDriverId) {
          clearInterval(this._reconnectTimer)
          this._reconnectTimer = null
        }
      }, interval)
    })

    this.on('ready', () => {
      if (this._reconnectTimer) {
        dbg(`[orchestrator] ✅ Connexion restaurée. Arrêt du cycle de reconnexion.`)
        clearInterval(this._reconnectTimer)
        this._reconnectTimer = null
      }
    })
  }

  _initListeners() {
    Object.values(this.drivers).forEach(driver => {
      driver.on('connection', (conn) => this._onDriverConnection(driver.id, conn))
      driver.on('disconnection', () => this._onDriverDisconnection(driver.id))
    })
  }

  async _onDriverConnection(driverId, conn) {
    const s = settings.get()
    
    // Sécurité : on ignore si le driver n'est pas celui préféré (sauf si fallback)
    if (driverId !== s.preferredDriver && !s.fallbackEnabled) return

    dbg(`[orchestrator] 🎯 iPhone détecté via ${driverId} (${conn.type || 'USB'})`)

    this.activeDriverId = driverId
    this.activeConnection = { ...conn, driver: driverId }
    
    gpsBridge.setActiveDriver(this.drivers[driverId])
    this._handleNewConnection(this.activeConnection)
  }

  _onDriverDisconnection(driverId) {
    if (this.activeDriverId === driverId) {
      dbg(`[orchestrator] Driver ${driverId} déconnecté.`)
      this._handleDisconnection()
    }
  }

  _handleNewConnection(conn) {
    const typeLabel = conn.type || 'USB'
    sendStatus('tunneld', 'ready', `Connecté via ${typeLabel} (${conn.driver})`, {
      type: typeLabel,
      driver: conn.driver
    })

    if (this.isCompanionConnected) this._startHeartbeatCycle()
    this.emit('ready', conn)
  }

  _handleDisconnection() {
    this.activeConnection = null
    this.activeDriverId = null
    gpsBridge.setActiveDriver(null)
    this._stopAllHeartbeats()
    sendStatus('tunneld', 'scanning', 'Recherche iPhone...')
    this.emit('lost')
  }

  async start() {
    if (this._isQuitting) return
    const s = settings.get()
    
    // 1. Support de l'adresse tunnel manuelle (iOS 17+ VM / Docker)
    if (s.manualTunnelAddress && s.manualTunnelAddress.includes(':')) {
      const parts = s.manualTunnelAddress.split(':')
      const port = parts.pop()
      const address = parts.join(':').replace(/[\[\]]/g, '')
      
      dbg(`[orchestrator] 🛠️ Utilisation de l'adresse RSD manuelle : ${address}:${port}`)
      
      this.activeDriverId = s.preferredDriver || 'pymobiledevice'
      const driver = this.drivers[this.activeDriverId]
      
      if (driver) {
        const conn = { 
          address, 
          port: parseInt(port), 
          type: 'MANUAL', 
          driver: this.activeDriverId 
        }
        this.activeConnection = conn
        driver.tunnelInfo = conn
        driver.isActive = true
        gpsBridge.setActiveDriver(driver)
        this._handleNewConnection(conn)
        return
      }
    }

    // 2. Mode standard (Auto-détection)
    const driverId = s.preferredDriver || 'go-ios'
    dbg(`[orchestrator] Démarrage du driver unique : ${driverId}`)
    
    if (this.drivers[driverId]) {
      // Transmission du mode réseau seul pour PMD3
      if (driverId === 'pymobiledevice') {
        this.drivers[driverId].networkOnlyMode = s.networkOnlyMode
      }
      await this.drivers[driverId].startTunnel()
    }

    sendStatus('tunneld', 'scanning', `Recherche iPhone (${driverId})...`)
  }

  async stopTunneld() {
    dbg('[orchestrator] Arrêt de tous les tunnels...')
    for (const driver of Object.values(this.drivers)) {
      await driver.stopTunnel()
    }
    this._stopAllHeartbeats()
    this.activeConnection = null
    this.activeDriverId = null
  }

  // --- Gestion Heartbeat et utilitaires ---
  _startHeartbeatCycle() {
    this._stopAllHeartbeats()
    if (!this.activeDriverId) return
    
    const hbInterval = setInterval(async () => {
      await gpsBridge.setLocation(null, null, 'heartbeat') // Appel via proxy
    }, 15000)

    this.heartbeatRunners.set('active', { stop: () => clearInterval(hbInterval) })
  }

  _stopAllHeartbeats() {
    for (const hb of this.heartbeatRunners.values()) hb.stop()
    this.heartbeatRunners.clear()
  }

  handleIphoneIpDetected(ip) {
    this.isCompanionConnected = true
    this.companionIp = ip
    if (this.activeConnection) this._startHeartbeatCycle()
  }

  getRsdAddress() { return this.activeConnection?.address }
  getRsdPort() { return this.activeConnection?.port }
  getConnectionType() { return this.activeConnection?.type || 'NONE' }
  getDeviceInfo() { return this.activeConnection?.deviceInfo || {} }
  isStarting() { return Object.values(this.drivers).some(d => d.isStarting) }
  
  async forceRefresh() { 
    await this.stopTunneld()
    const s = settings.get()
    if (!s.manualTunnelMode) {
      setTimeout(() => this.start(), 1000)
    }
  }

  applySettings() { this.forceRefresh() }
  setQuitting() { this._isQuitting = true; this.stopTunneld() }
}

module.exports = new ConnectionOrchestrator()
