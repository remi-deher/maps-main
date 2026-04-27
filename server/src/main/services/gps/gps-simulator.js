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
    this._eveilInterval = null

    this._startEveilCycle()
  }

  /**
   * Cycle de maintien en éveil pour iOS
   * Si aucune injection n'a eu lieu depuis 30s, on injecte une micro-dérive (Jitter)
   */
  _startEveilCycle() {
    if (this._eveilInterval) clearInterval(this._eveilInterval)
    this._eveilInterval = setInterval(async () => {
      if (this._isQuitting || !this.lastCoords) return

      const settings = require('../settings-manager')
      if (!settings.get('isEveilMode')) return

      const now = Date.now()
      // Si on n'a pas bougé depuis 25 secondes, on provoque un micro-mouvement
      if (now - this.lastInjectionTime > 25000) {
        const { lat, lon, name } = this.lastCoords
        
        // Micro-jitter (~1.5 mètres)
        const jitterLat = (Math.random() - 0.5) * 0.000015
        const jitterLon = (Math.random() - 0.5) * 0.000015
        
        const rsdAddress = this.tunnel.getRsdAddress()
        const rsdPort = this.tunnel.getRsdPort()

        if (rsdAddress && rsdPort) {
          dbg(`[gps-simulator] 🛡️ Mode Éveil : Micro-dérive appliquée (+${(jitterLat*111111).toFixed(1)}m)`)
          // On injecte sans mettre à jour this.lastCoords pour garder la référence pure
          await this.commander.execute('set', rsdAddress, rsdPort, [
            String(lat + jitterLat), 
            String(lon + jitterLon)
          ])
          // On ne met pas à jour this.lastInjectionTime pour laisser les vrais mouvements prioritaires,
          // mais on met à jour un flag interne si besoin. En fait on peut mettre à jour pour éviter le double-jitter.
          this.lastInjectionTime = Date.now()
        }
      }
    }, 30000)
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
