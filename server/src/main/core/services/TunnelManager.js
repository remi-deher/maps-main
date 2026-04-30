'use strict'

const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../../logger')
const gpsBridge = require('./gps/gps-bridge')
const settings = require('./settings-manager')
const Pmd3Driver = require('../drivers/Pmd3Driver')
const GoIosDriver = require('../drivers/GoIosDriver')
const mdns = require('./MdnsManager')

/**
 * TunnelManager (V2) - Orchestrateur de connexion unifié.
 */
class TunnelManager extends EventEmitter {
  constructor() {
    super()
    this.drivers = {
      'pymobiledevice': new Pmd3Driver(),
      'go-ios': new GoIosDriver()
    }
    
    mdns.start()
    
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
    const checkAndStart = () => {
      const s = settings.get()
      if (this._isQuitting || s.manualTunnelMode) return

      if (!this.activeDriverId && !this.isStarting()) {
        mdns.start()
        this.start().catch(e => dbg(`[orchestrator] ⚠️ Autostart fail: ${e.message}`))
      }
    }

    this._reconnectTimer = setInterval(checkAndStart, 10000)
    
    // Premier lancement immédiat
    setTimeout(checkAndStart, 1000)
  }

  _initListeners() {
    Object.values(this.drivers).forEach(driver => {
      driver.on('connection', (conn) => this._onDriverConnection(driver.id, conn))
      driver.on('disconnection', () => this._onDriverDisconnection(driver.id))
    })
  }

  async _onDriverConnection(driverId, conn) {
    const s = settings.get()
    if (driverId !== s.preferredDriver && !s.fallbackEnabled) return

    dbg(`[orchestrator] 🎯 iPhone détecté via ${driverId} (${conn.type || 'USB'})`)
    this.activeDriverId = driverId
    this.activeConnection = { ...conn, driver: driverId }
    
    gpsBridge.setActiveDriver(this.drivers[driverId])
    this._handleNewConnection(this.activeConnection)
  }

  _onDriverDisconnection(driverId) {
    if (this.activeDriverId === driverId) {
      this._handleDisconnection()
    }
  }

  _handleNewConnection(conn) {
    mdns.stop()
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
    mdns.start()
    sendStatus('tunneld', 'scanning', 'Recherche iPhone...')
    this.emit('lost')
  }

  async start() {
    if (this._isQuitting) return
    const s = settings.get()
    
    // Support manuel
    if (s.manualTunnelAddress && s.manualTunnelAddress.includes(':')) {
      const parts = s.manualTunnelAddress.split(':')
      const port = parts.pop()
      const address = parts.join(':').replace(/[\[\]]/g, '')
      this.activeDriverId = s.preferredDriver || 'pymobiledevice'
      const driver = this.drivers[this.activeDriverId]
      if (driver) {
        const conn = { address, port: parseInt(port), type: 'MANUAL', driver: this.activeDriverId }
        this.activeConnection = conn
        driver.tunnelInfo = conn; driver.isActive = true;
        gpsBridge.setActiveDriver(driver)
        this._handleNewConnection(conn)
        return
      }
    }

    const driverId = s.preferredDriver || 'pymobiledevice'
    if (this.drivers[driverId]) {
      if (driverId === 'pymobiledevice') this.drivers[driverId].networkOnlyMode = s.networkOnlyMode
      try {
        await this.drivers[driverId].startTunnel()
      } catch (e) {
        dbg(`[orchestrator] ❌ Échec démarrage driver ${driverId}: ${e.message}`)
      }
    }
    sendStatus('tunneld', 'scanning', `Recherche iPhone (${driverId})...`)
  }

  async stopTunneld() {
    for (const driver of Object.values(this.drivers)) await driver.stopTunnel()
    this._stopAllHeartbeats()
    this.activeConnection = null
    this.activeDriverId = null
  }

  _startHeartbeatCycle() {
    this._stopAllHeartbeats()
    if (!this.activeDriverId) return
    const hbInterval = setInterval(async () => {
      try {
        await gpsBridge.setLocation(null, null, 'heartbeat')
      } catch (e) {
        dbg(`[orchestrator] ⚠️ Heartbeat failed: ${e.message}`)
      }
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

  getRsdAddress() { return this.activeConnection?.address || null }
  getRsdPort() { return this.activeConnection?.port || null }
  
  getConnectionType() {
    return this.activeConnection?.type || 'UNKNOWN'
  }

  getDeviceInfo() {
    if (!this.activeConnection) return null
    return {
      udid: this.activeConnection.udid,
      name: this.activeConnection.name || 'iPhone',
      driver: this.activeDriverId
    }
  }

  isStarting() { return Object.values(this.drivers).some(d => d.isStarting) }
  
  async forceRefresh() { 
    await this.stopTunneld()
    const s = settings.get()
    if (!s.manualTunnelMode) setTimeout(() => this.start(), 1000)
  }

  applySettings() { 
    this.forceRefresh().catch(e => dbg(`[orchestrator] ❌ Erreur applySettings: ${e.message}`))
  }

  setQuitting() { 
    this._isQuitting = true
    mdns.stop()
    this.stopTunneld()
  }
}

module.exports = new TunnelManager()
