'use strict'

const { EventEmitter } = require('events')
const { dbg } = require('../../logger')
const GpsCommander = require('./gps-commander')

/**
 * GpsSimulator - Orchestre la simulation GPS (Version Simplifiée / Zen)
 */
class GpsSimulator extends EventEmitter {
  constructor(tunnelManager, companionServer = null) {
    super()
    this.tunnel = tunnelManager
    this.companion = companionServer
    this.commander = new GpsCommander()
    this.lastCoords = null
    this.lastInjectionTime = 0
    this._isQuitting = false
  }

  async setLocation(lat, lon, name = null, force = false) {
    if (this._isQuitting) return { success: false, error: 'Simulation en fermeture' }

    // Vérification du mode de fonctionnement
    const settings = require('../settings-manager')
    const mode = settings.get('operationMode')

    if (mode === 'client-server') {
      if (!this.companion || !this.companion.hasActiveClients()) {
        dbg(`[gps-simulator] 🚫 Injection refusée : Aucun iPhone connecté (Mode Client/Serveur)`)
        return { success: false, error: 'Mode Client/Serveur actif : Veuillez connecter votre iPhone' }
      }
    }
    
    // Throttling : éviter le spam (max 1 injection toutes les 500ms)
    const now = Date.now()
    if (!force && (now - this.lastInjectionTime < 500)) {
      dbg(`[gps-simulator] ⏳ Requête ignorée (throttling - ${now - this.lastInjectionTime}ms)`)
      return { success: true, ignored: true }
    }
    this.lastInjectionTime = now
    
    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()

    if (!rsdAddress || !rsdPort) {
      this.lastCoords = { lat, lon, name }
      return { success: false, error: 'Tunnel non prêt, position mise en file d\'attente' }
    }

    try {
      const result = await this.commander.execute('set', rsdAddress, rsdPort, [String(lat), String(lon)])
      
      if (result.success) {
        this.lastCoords = { lat, lon, name }
        this.emit('location-changed', { lat, lon, name })
      } else {
        dbg(`[gps-simulator] ❌ Échec simulation: ${result.error}`)
      }
      return result
    } catch (e) {
      dbg(`[gps-simulator] ❌ Erreur critique: ${e.message}`)
      return { success: false, error: e.message }
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
