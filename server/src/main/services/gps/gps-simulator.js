'use strict'

const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../../logger')
const GpsCommander = require('./gps-commander')
const GpsWatchdog = require('./gps-watchdog')

/**
 * GpsSimulator - Orchestre la simulation GPS
 */
class GpsSimulator extends EventEmitter {
  constructor(tunnelManager) {
    super()
    this.tunnel = tunnelManager
    this.commander = new GpsCommander()
    this.watchdog = new GpsWatchdog(() => this.onTunnelRestored())
    
    this.lastCoords = null
    this.restorationTimer = null
    this._isQuitting = false
    this._isLaunching = false

    // Relayer les logs
    this.commander.runner.on('log', (msg) => this.emit('log', msg))
  }

  async setLocation(lat, lon, name = null) {
    if (this._isLaunching) return { success: false, error: 'Simulation en cours de lancement' }
    
    // Si on est en phase de restauration, on met juste à jour les coordonnées cibles
    if (this.restorationTimer) {
      this.lastCoords = { lat, lon, name }
      return { success: false, error: 'Tunnel en cours de stabilisation, position mise en file d\'attente' }
    }

    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()

    if (!rsdAddress || !rsdPort) {
      this.lastCoords = { lat, lon, name }
      return { success: false, error: 'Tunnel non pret, position mise en file d\'attente' }
    }

    this._isLaunching = true
    try {
      this.commander.stop()
      const result = await this.commander.execute('set', rsdAddress, rsdPort, [String(lat), String(lon)])
      
      if (result.success) {
        this.lastCoords = { lat, lon, name }
        this.emit('location-changed', { lat, lon, name })
        this.watchdog.start(rsdAddress, rsdPort)
      }
      return result
    } finally {
      this._isLaunching = false
    }
  }

  async clearLocation() {
    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()
    
    this.watchdog.stop()
    this.commander.stop()
    this.lastCoords = null
    
    if (!rsdAddress) return { success: true }
    return await this.commander.execute('clear', rsdAddress, rsdPort)
  }

  onTunnelRestored() {
    if (!this.lastCoords || this._isQuitting || this.restorationTimer) return
    
    dbg('[gps-simulator] Tentative de restauration automatique de la position...')
    if (this.restorationTimer) clearTimeout(this.restorationTimer)
    
    this.restorationTimer = setTimeout(async () => {
      this.restorationTimer = null
      if (this.lastCoords && !this._isQuitting) {
        const { lat, lon, name } = this.lastCoords
        dbg(`[gps-simulator] Restauration vers ${lat}, ${lon} (${name})`)
        await this.setLocation(lat, lon, name)
      }
    }, 5000)
  }

  stop() {
    this.watchdog.stop()
    this.commander.stop()
  }

  destroy() {
    this._isQuitting = true
    this.stop()
    this.lastCoords = null
  }
}

module.exports = GpsSimulator
