'use strict'

const { EventEmitter } = require('events')
const { dbg } = require('../../../logger')

/**
 * GpsSequencer - Gère l'exécution séquentielle d'un trajet GPS.
 */
class GpsSequencer extends EventEmitter {
  constructor() {
    super()
    this.points = []
    this.currentIndex = -1
    this.timer = null
    this.isRunning = false
    this.isPaused = false
    this.speedMultiplier = 1.0
    this.onInjectCallback = null
    this.isLooping = false
    this.isInjecting = false
    this.lastStepTime = 0
  }

  /**
   * Configure la séquence de points.
   * @param {Array} points [{lat, lon, time}]
   * @param {Function} onInject Callback async (lat, lon, name)
   */
  load(points, onInject) {
    this.stop()
    this.points = points
    this.onInjectCallback = onInject
    this.currentIndex = -1
    dbg(`[gps-sequencer] Trajet chargé : ${points.length} points.`)
  }

  /**
   * Démarre ou reprend la séquence.
   */
  start() {
    if (this.points.length === 0) return
    if (this.isRunning && !this.isPaused) return

    this.isRunning = true
    this.isPaused = false
    this.lastStepTime = Date.now()
    dbg('[gps-sequencer] ▶️ Démarrage de la séquence')
    this.emit('status', { state: 'running', index: this.currentIndex, total: this.points.length })

    // On lance le premier step immédiatement (injection du point 0)
    this._step()
  }

  /**
   * Met en pause la séquence.
   */
  pause() {
    this.isPaused = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    dbg('[gps-sequencer] ⏸️ Séquence en pause')
    this.emit('status', { state: 'paused', index: this.currentIndex, total: this.points.length })
  }

  /**
   * Arrête définitivement la séquence.
   */
  stop() {
    this.isRunning = false
    this.isPaused = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.currentIndex = -1
    dbg('[gps-sequencer] ⏹️ Séquence arrêtée')
    this.emit('status', { state: 'stopped', index: -1, total: this.points.length })
  }

  /**
   * Passe au point suivant.
   */
  async _step() {
    if (!this.isRunning || this.isPaused) return

    this.currentIndex++
    if (this.currentIndex >= this.points.length) {
      if (this.isLooping) {
        dbg('[gps-sequencer] 🔄 Boucle active, redémarrage du trajet')
        this.currentIndex = -1
        this._step()
        return
      }
      dbg('[gps-sequencer] ✅ Séquence terminée')
      this.stop()
      this.emit('finished')
      return
    }

    const point = this.points[this.currentIndex]
    const name = `Point ${this.currentIndex + 1}/${this.points.length}`

    if (this.onInjectCallback) {
      if (this.isInjecting) {
        // dbg(`[gps-sequencer] ⏩ Saut de point (injection précédente en cours)`)
      } else {
        this.isInjecting = true
        this.onInjectCallback(point.lat, point.lon, name)
          .catch(e => dbg(`[gps-sequencer] ⚠️ Erreur injection : ${e.message}`))
          .finally(() => { this.isInjecting = false })
      }
    }

    this.emit('progress', {
      index: this.currentIndex,
      total: this.points.length,
      lat: point.lat,
      lon: point.lon,
      speed: this._calculateCurrentSpeed()
    })

    this._scheduleNext()
  }

  /**
   * Calcule le délai avant le prochain point.
   */
  _scheduleNext() {
    if (!this.isRunning || this.isPaused) return
    if (this.currentIndex >= this.points.length - 1) {
      // Si on est au dernier point, on fait un dernier step pour finir
      this.timer = setTimeout(() => this._step(), 100)
      return
    }

    const currentPoint = this.points[Math.max(0, this.currentIndex)]
    const nextPoint = this.points[this.currentIndex + 1]

    let delay = 1000 // Par défaut 1s

    if (currentPoint.time && nextPoint.time) {
      delay = nextPoint.time - currentPoint.time
    }

    // Application du multiplicateur de vitesse
    const adjustedDelay = Math.max(50, delay / this.speedMultiplier)

    // Calcul de l'heure cible pour le prochain point
    const targetTime = (this.lastStepTime || Date.now()) + adjustedDelay
    const now = Date.now()
    const nextTimeout = Math.max(10, targetTime - now)

    this.timer = setTimeout(() => {
      this.lastStepTime = targetTime
      this._step()
    }, nextTimeout)
  }

  _calculateCurrentSpeed() {
    if (this.currentIndex <= 0) return 0;
    const p1 = this.points[this.currentIndex - 1];
    const p2 = this.points[this.currentIndex];
    if (!p1.time || !p2.time) return 0;
    
    const dist = this._calculateDistance(p1.lat, p1.lon, p2.lat, p2.lon); // mètres
    const time = (p2.time - p1.time) / 1000; // secondes
    if (time <= 0) return 0;
    
    return parseFloat(((dist / time) * 3.6).toFixed(1)); // km/h
  }

  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  setSpeed(multiplier) {
    this.speedMultiplier = Math.max(0.1, multiplier)
    dbg(`[gps-sequencer] ⚡ Vitesse ajustée : x${this.speedMultiplier}`)
  }

  setLooping(enabled) {
    this.isLooping = !!enabled
    dbg(`[gps-sequencer] 🔄 Mode boucle : ${this.isLooping ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`)
  }
}

module.exports = new GpsSequencer()
