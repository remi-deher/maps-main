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

    this._initListeners()
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
  
  async forceRefresh() { 
    await this.stopTunneld()
    setTimeout(() => this.start(), 1000)
  }

  applySettings() { this.forceRefresh() }
  setQuitting() { this._isQuitting = true; this.stopTunneld() }
}

module.exports = new ConnectionOrchestrator()
