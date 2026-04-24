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
    this.jitterTimer = null
    this._isQuitting = false
    this._isLaunching = false
  }

  async setLocation(lat, lon, name = null) {
    this._resetJitter()
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
      } else {
        // --- AMÉLIORATION : Gestion des erreurs de connexion ---
        if (result.error && (result.error.includes('refuse') || result.error.includes('timeout') || result.error.includes('socket'))) {
          dbg(`[gps-simulator] ⚠️ Erreur de communication (Tunnel instable). Mise en file d'attente...`)
          // On laisse l'orchestrateur gérer la déconnexion, on garde juste les coords
          this.lastCoords = { lat, lon, name }
        } else {
          dbg(`[gps-simulator] ❌ Echec simulation: ${result.error}`)
        }
      }
      return result
    } finally {
      this._isLaunching = false
    }
  }

  _resetJitter() {
    if (this.jitterTimer) clearTimeout(this.jitterTimer)
    if (this._isQuitting) return
    // On passe à 30s pour plus de stabilité sur WiFi
    this.jitterTimer = setTimeout(() => this._applyJitter(), 30000)
  }

  async _applyJitter() {
    if (!this.lastCoords || this._isQuitting || this._isLaunching) return
    
    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()
    if (!rsdAddress) return

    // Micro-jitter de 0.000001 deg (~10cm) pour maintenir iOS éveillé
    const jitterLat = this.lastCoords.lat + (Math.random() > 0.5 ? 0.000001 : -0.000001)
    dbg(`[gps-simulator] Envoi Micro-Jitter de maintien d'activite (${jitterLat.toFixed(7)})`)
    
    try {
      const result = await this.commander.execute('set', rsdAddress, rsdPort, [String(jitterLat), String(this.lastCoords.lon)])
      if (result.success) {
        // Mise à jour de l'état pour que le client reste synchrone (évite la dérive fantôme)
        this.lastCoords.lat = jitterLat
        this.emit('location-changed', { lat: jitterLat, lon: this.lastCoords.lon, name: this.lastCoords.name })
      }
    } catch (e) {
      dbg(`[gps-simulator] Echec Jitter: ${e.message}`)
    }
    
    this._resetJitter()
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
    
    dbg(`[gps-simulator] ⚠️ Perte de simulation détectée (Tunnel down). Attente de la remontée automatique...`)
    
    if (this.restorationTimer) clearTimeout(this.restorationTimer)
    
    this.restorationTimer = setTimeout(async () => {
      this.restorationTimer = null
      if (this.lastCoords && !this._isQuitting) {
        const { lat, lon, name } = this.lastCoords
        dbg(`[gps-simulator] 🔄 Restauration automatique vers ${lat}, ${lon} (${name})`)
        await this.setLocation(lat, lon, name)
      }
    }, 10000) // 10s pour laisser le temps au tunnel de se stabiliser (IPv6, mDNS, etc.)
  }

  stop() {
    this.watchdog.stop()
    this.commander.stop()
    if (this.jitterTimer) clearTimeout(this.jitterTimer)
  }

  destroy() {
    this._isQuitting = true
    this.stop()
    this.lastCoords = null
  }
}

module.exports = GpsSimulator
