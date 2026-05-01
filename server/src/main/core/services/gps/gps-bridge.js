'use strict'

const { dbg } = require('../../../logger')
const gpsSequencer = require('./GpsSequencer')

/**
 * GpsBridge - Proxy délégué
 * Ne contient plus de logique d'exécution, délègue tout au Driver actif fourni par l'Orchestrateur.
 */
class GpsBridge {
  constructor() {
    this.activeDriver = null
    this.isReady = false
  }

  /**
   * Injecte le driver actif (appelé par TunneldManager)
   */
  setActiveDriver(driver) {
    this.activeDriver = driver
    this.isReady = !!driver
    if (driver) {
      dbg(`[gps-bridge] 🔌 Driver actif mis à jour : ${driver.id}`)
    }
  }

  async start() {
    dbg('[gps-bridge] ✅ Bridge initialisé en mode Délégué')
    return { success: true }
  }

  async setLocation(lat, lon, name = 'Position manuelle') {
    if (!this.activeDriver) {
      return { success: false, error: 'Aucun driver de connexion actif' }
    }

    dbg(`[gps-commander] Commande via PONT : set sur ${this.activeDriver.id}`)
    return await this.activeDriver.setLocation(lat, lon, name)
  }

  async clearLocation() {
    if (!this.activeDriver) return { success: false }
    return await this.activeDriver.clearLocation()
  }

  // Gestion des trajets via le Séquenceur
  async playGpx(gpxPath) {
    const routeGenerator = require('./route-generator')
    const gpxContent = require('fs').readFileSync(gpxPath, 'utf8')
    const points = routeGenerator.parseGpx(gpxContent)
    
    dbg(`[gps-bridge] Lancement trajet : ${points.length} points`)
    
    gpsSequencer.load(points, async (lat, lon, name) => {
      return await this.setLocation(lat, lon, name)
    })
    
    gpsSequencer.start()
    return { success: true, pointsCount: points.length }
  }

  stopRoute() {
    gpsSequencer.stop()
  }

  pauseRoute() {
    gpsSequencer.pause()
  }

  resumeRoute() {
    gpsSequencer.start()
  }

  setLooping(enabled) {
    gpsSequencer.setLooping(enabled)
  }
}

module.exports = new GpsBridge()
