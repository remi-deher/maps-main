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
    dbg('[gps-sequencer] ▶️ Démarrage de la séquence')
    this.emit('status', { state: 'running', index: this.currentIndex, total: this.points.length })
    this._scheduleNext()
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
      try {
        await this.onInjectCallback(point.lat, point.lon, name)
      } catch (e) {
        dbg(`[gps-sequencer] ⚠️ Erreur injection au point ${this.currentIndex}: ${e.message}`)
      }
    }

    this.emit('progress', { 
      index: this.currentIndex, 
      total: this.points.length, 
      lat: point.lat, 
      lon: point.lon 
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

    // Application du multiplicateur de vitesse (pour accélérer la simulation)
    delay = Math.max(100, delay / this.speedMultiplier)

    this.timer = setTimeout(() => this._step(), delay)
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
