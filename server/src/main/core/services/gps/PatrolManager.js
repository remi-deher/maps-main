'use strict'

const { EventEmitter } = require('events')
const { dbg } = require('../../../logger')
const routeGenerator = require('./route-generator')
const gpsSequencer = require('./GpsSequencer')

/**
 * PatrolManager - Gère les déplacements aléatoires dans une zone définie.
 */
class PatrolManager extends EventEmitter {
  constructor() {
    super()
    this.zone = null
    this.isActive = false
    this.timer = null
  }

  /**
   * Met à jour la zone de patrouille et démarre/arrête si besoin.
   * @param {Object} zone { type, center, radius, bounds, active }
   */
  update(zone) {
    const wasActive = this.isActive
    this.zone = zone
    this.isActive = !!zone.active

    if (this.isActive && !wasActive) {
      dbg('[patrol] 🛡️ Démarrage de la patrouille')
      this._nextStep()
    } else if (!this.isActive && wasActive) {
      dbg('[patrol] ⏹️ Arrêt de la patrouille')
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      gpsSequencer.stop()
    }
  }

  async _nextStep() {
    if (!this.isActive || !this.zone) return

    try {
      const target = this._getRandomPoint()
      dbg(`[patrol] 📍 Nouvelle destination : ${target.lat.toFixed(6)}, ${target.lon.toFixed(6)}`)

      // Calcul d'un itinéraire routier (OSRM) vers la cible
      // On utilise le dernier point connu du séquenceur ou le centre de la zone
      const start = gpsSequencer.points.length > 0 
        ? gpsSequencer.points[gpsSequencer.currentIndex] || gpsSequencer.points[0]
        : { lat: this.zone.center.lat, lon: this.zone.center.lon }

      const gpxPath = await routeGenerator.generateOsrmRoute(
        { lat: start.lat, lon: start.lon },
        { lat: target.lat, lon: target.lon },
        'walking', // Patrouille à pied par défaut pour plus de réalisme
        5
      )

      const points = routeGenerator.parseGpx(require('fs').readFileSync(gpxPath, 'utf8'))
      
      // On attend la fin du trajet en cours
      gpsSequencer.load(points, async (lat, lon, name) => {
        this.emit('inject', { lat, lon, name })
      })

      gpsSequencer.once('finished', () => {
        if (!this.isActive) return
        
        // Pause aléatoire à destination (entre 30s et 2min)
        const waitTime = Math.floor(Math.random() * 90000) + 30000
        dbg(`[patrol] ⏳ Pause à destination (~${Math.round(waitTime/1000)}s)...`)
        
        this.timer = setTimeout(() => {
          this._nextStep()
        }, waitTime)
      })

      gpsSequencer.start()

    } catch (e) {
      dbg(`[patrol] ⚠️ Erreur étape : ${e.message}`)
      this.timer = setTimeout(() => this._nextStep(), 10000)
    }
  }

  _getRandomPoint() {
    if (this.zone.type === 'circle') {
      return this._getRandomPointInCircle(this.zone.center, this.zone.radius)
    } else {
      return this._getRandomPointInRectangle(this.zone.bounds)
    }
  }

  _getRandomPointInCircle(center, radius) {
    const r = radius / 111300 // Conversion mètres en degrés approx
    const y0 = center.lat
    const x0 = center.lon
    const u = Math.random()
    const v = Math.random()
    const w = r * Math.sqrt(u)
    const t = 2 * Math.PI * v
    const x = w * Math.cos(t)
    const y = w * Math.sin(t)
    
    // Ajustement pour la compression de la longitude selon la latitude
    const xAdjusted = x / Math.cos(y0 * Math.PI / 180)
    
    return { lat: y + y0, lon: xAdjusted + x0 }
  }

  _getRandomPointInRectangle(bounds) {
    const { ne, sw } = bounds
    const lat = Math.random() * (ne.lat - sw.lat) + sw.lat
    const lon = Math.random() * (ne.lon - sw.lon) + sw.lon
    return { lat, lon }
  }
}

module.exports = new PatrolManager()
