'use strict'

const { EventEmitter } = require('events')
const { dbg } = require('../../../logger')
const settings = require('../settings-manager')
const GpsCommander = require('./gps-commander')
const gpsSequencer = require('./GpsSequencer')

/**
 * GpsSimulator (V2) - Orchestre la simulation GPS.
 */
class GpsSimulator extends EventEmitter {
  constructor(tunnelManager, companionServer = null) {
    super()
    this.tunnel = tunnelManager
    this.companion = companionServer
    this.commander = new GpsCommander()
    
    // Chargement de la dernière position connue pour la reprise après reboot
    const savedLoc = settings.get('lastActiveLocation')
    this.lastCoords = savedLoc || null
    this.lastInjectionTime = 0
    this._isQuitting = false
    this._eveilInterval = null

    this._startEveilCycle()

    // Auto-réinjection dès que le tunnel est prêt
    this.tunnel.on('ready', () => {
      if (this.lastCoords && !this._isQuitting) {
        dbg(`[gps-simulator] ♻️ Reprise après reboot : Ré-injection de la position mémorisée`)
        this.setLocation(this.lastCoords.lat, this.lastCoords.lon, this.lastCoords.name, true)
      }
    })

    if (this.companion) {
      this.companion.on('request-location', (data) => {
        dbg(`[gps-simulator] 📲 Commande iPhone reçue : ${data.lat}, ${data.lon}`)
        this.setLocation(data.lat, data.lon, data.name)
      })
      
      this.companion.on('request-clear', () => {
        dbg(`[gps-simulator] 📲 Commande iPhone reçue : Clear`)
        this.clearLocation()
      })

      this.companion.on('settings-updated', () => {
        this.refreshSettings()
      })
    }

    // Gestion des événements du Séquenceur
    gpsSequencer.on('progress', (data) => {
      this.lastCoords = { lat: data.lat, lon: data.lon, name: `Route (${data.index+1}/${data.total})` }
      this.lastInjectionTime = Date.now()
      this.emit('location-changed', this.lastCoords)
    })

    gpsSequencer.on('status', (status) => {
      if (this.companion) {
        this.companion.status.route = status
        this.companion._broadcast('STATUS_UPDATE', { route: status })
      }
    })

    gpsSequencer.on('finished', () => {
      if (this.companion) {
        dbg('[gps-simulator] 🏁 Séquence terminée, envoi de ROUTE_FINISHED')
        this.companion._broadcast('ROUTE_FINISHED', { 
           timestamp: Date.now(),
           location: this.lastCoords
        })
      }
    })
  }

  _startEveilCycle() {
    if (this._eveilInterval) clearInterval(this._eveilInterval)
    
    const intervalSeconds = settings.get('eveilInterval') || 5
    const intervalMs = intervalSeconds * 1000
    
    this._eveilInterval = setInterval(async () => {
      if (this._isQuitting || !this.lastCoords) return
      if (!settings.get('isEveilMode')) return
      
      // On suspend l'éveil si une route est en cours
      if (gpsSequencer.isRunning && !gpsSequencer.isPaused) return

      const now = Date.now()
      // On déclenche la dérive si aucune injection n'a eu lieu depuis (intervalle - 1s)
      if (now - this.lastInjectionTime > (intervalMs - 1000)) {
        const { lat, lon } = this.lastCoords
        const jitterLat = (Math.random() - 0.5) * 0.000015
        const jitterLon = (Math.random() - 0.5) * 0.000015
        
        const rsdAddress = this.tunnel.getRsdAddress()
        const rsdPort = this.tunnel.getRsdPort()

        if (rsdAddress && rsdPort) {
          try {
            dbg(`[gps-simulator] 🛡️ Mode Éveil : Micro-dérive appliquée (${intervalSeconds}s)`)
            await this.commander.execute('set', rsdAddress, rsdPort, [
              String(lat + jitterLat), 
              String(lon + jitterLon)
            ])
            this.lastInjectionTime = Date.now()
          } catch (e) {
            dbg(`[gps-simulator] ⚠️ Éveil failed: ${e.message}`)
          }
        }
      }
    }, intervalMs)
  }

  async setLocation(lat, lon, name = null, force = false) {
    if (this._isQuitting) return { success: false, error: 'Simulation en fermeture' }

    const mode = settings.get('operationMode')

    if (mode === 'client-server') {
      if (!this.companion || !this.companion.hasActiveClients()) {
        return { success: false, error: 'Mode Client/Serveur actif : Veuillez connecter votre iPhone' }
      }
    }
    
    const now = Date.now()
    if (!force && (now - this.lastInjectionTime < 100)) return { success: true, ignored: true }
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
        settings.save({ lastActiveLocation: this.lastCoords })
        this.emit('location-changed', { lat, lon, name })
      }
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  async clearLocation() {
    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()
    this.lastCoords = null
    settings.save({ lastActiveLocation: null })
    if (!rsdAddress) return { success: true }
    return await this.commander.execute('clear', rsdAddress, rsdPort)
  }

  isActive() {
    return !!this.lastCoords
  }

  /**
   * Applique les nouveaux réglages (intervalle d'éveil, etc.)
   */
  refreshSettings() {
    this._startEveilCycle()
  }

  stop() { 
    if (this._eveilInterval) clearInterval(this._eveilInterval)
    this.commander.stop() 
  }
  destroy() { this._isQuitting = true; this.stop(); this.lastCoords = null; }
}

module.exports = GpsSimulator
