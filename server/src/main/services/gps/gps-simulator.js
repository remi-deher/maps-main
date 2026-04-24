'use strict'

const { EventEmitter } = require('events')
const { dbg } = require('../../logger')
const GpsCommander = require('./gps-commander')

/**
 * GpsSimulator - Orchestre la simulation GPS (Version Simplifiée / Zen)
 */
class GpsSimulator extends EventEmitter {
  constructor(tunnelManager) {
    super()
    this.tunnel = tunnelManager
    this.commander = new GpsCommander()
    this.lastCoords = null
    this._isLaunching = false
    this._isQuitting = false
  }

  async setLocation(lat, lon, name = null) {
    if (this._isLaunching || this._isQuitting) return { success: false, error: 'Simulation occupée ou en fermeture' }
    
    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()

    if (!rsdAddress || !rsdPort) {
      this.lastCoords = { lat, lon, name }
      return { success: false, error: 'Tunnel non prêt, position mise en file d\'attente' }
    }

    this._isLaunching = true
    try {
      // Le pont gère lui-même le remplacement du processus précédent
      const result = await this.commander.execute('set', rsdAddress, rsdPort, [String(lat), String(lon)])
      
      if (result.success) {
        this.lastCoords = { lat, lon, name }
        this.emit('location-changed', { lat, lon, name })
      } else {
        dbg(`[gps-simulator] ❌ Échec simulation: ${result.error}`)
      }
      return result
    } finally {
      this._isLaunching = false
    }
  }

  async clearLocation() {
    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()
    
    this.lastCoords = null
    if (!rsdAddress) return { success: true }
    
    return await this.commander.execute('clear', rsdAddress, rsdPort)
  }

  stop() {
    this.commander.stop()
  }

  destroy() {
    this._isQuitting = true
    this.stop()
    this.lastCoords = null
  }
}

module.exports = GpsSimulator
