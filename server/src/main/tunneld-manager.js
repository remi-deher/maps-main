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
      if (this._reconnectTimer || this._isQuitting) return
      
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
    const connType = conn.type?.toUpperCase().includes('WIFI') ? 'WIFI' : 'USB'
    const preferredDriver = connType === 'WIFI' ? s.wifiDriver : s.usbDriver

    dbg(`[orchestrator] Détection via ${driverId} (${connType}). Préféré: ${preferredDriver}`)

    // Si on a déjà une connexion active via le driver préféré, on ignore le reste
    if (this.activeDriverId === preferredDriver && driverId !== preferredDriver) {
      return
    }

    // Basculement à chaud si le nouveau driver est le préféré
    if (driverId === preferredDriver && this.activeDriverId !== preferredDriver) {
      dbg(`[orchestrator] 🔄 Basculement à chaud vers le driver préféré : ${driverId}`)
    }

    this.activeDriverId = driverId
    this.activeConnection = { ...conn, driver: driverId }
    
    // On branche le driver sur le Bridge GPS
    gpsBridge.setActiveDriver(this.drivers[driverId])
    
    this._handleNewConnection(this.activeConnection)
  }

  _onDriverDisconnection(driverId) {
    if (this.activeDriverId === driverId) {
      dbg(`[orchestrator] Driver actif ${driverId} déconnecté.`)
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
    sendStatus('tunneld', 'scanning', 'Connexion perdue, recherche...')
    this.emit('lost')
  }

  async start() {
    if (this._isQuitting) return
    const s = settings.get()
    
    dbg(`[orchestrator] Initialisation des drivers (USB: ${s.usbDriver}, WiFi: ${s.wifiDriver})...`)
    
    // Sécurité anti-conflit
    let needed = [...new Set([s.usbDriver, s.wifiDriver])]
    if (needed.includes('pymobiledevice') && needed.includes('go-ios')) {
      dbg('[orchestrator] ⚠️ Priorité PMD3 : go-ios sera désactivé.')
      needed = ['pymobiledevice']
    }

    for (const id of needed) {
      await this.drivers[id].startTunnel()
    }

    sendStatus('tunneld', 'scanning', `Recherche iPhone (${needed.join(', ')})...`)
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
    setTimeout(() => this.start(), 1000)
  }

  applySettings() { this.forceRefresh() }
  setQuitting() { this._isQuitting = true; this.stopTunneld() }
}

module.exports = new ConnectionOrchestrator()
