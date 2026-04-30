'use strict'

const { dbg } = require('../../../logger')

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

  // Compatibilité avec les anciennes méthodes de trajet si nécessaire
  async playGpx(gpxPath) {
    const routeGenerator = require('./route-generator')
    const gpxContent = require('fs').readFileSync(gpxPath, 'utf8')
    const points = routeGenerator.parseGpx(gpxContent)
    
    dbg(`[gps-bridge] Lecture GPX : ${points.length} points`)
    // La boucle de trajet est gérée par le simulateur, le bridge ne fait qu'exécuter un point
    return { success: true, points }
  }
}

module.exports = new GpsBridge()
