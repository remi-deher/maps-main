'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const { PYTHON } = require('../python-resolver')
const { TUNNEL_RESTART_DELAY } = require('../constants')
const nativeBonjour = require('./native-bonjour')

/**
 * TunneldService - Gère le démon pymobiledevice3 remote tunneld
 * Supporte USB et WiFi via une découverte unifiée.
 */
class TunneldService extends EventEmitter {
  constructor() {
    super()
    this.process = null
    this.restartTimer = null
    this.fallbackTimer = null
    this._isQuitting = false
    this.devices = new Map() // udid -> connectionInfo
  }

  start() {
    if (this._isQuitting) return
    this.stop()

    dbg('[tunneld-service] lancement du démon tunneld...')
    sendStatus('tunneld', 'starting', 'Initialisation du démon tunnel...')

    // On lance tunneld. Sur Windows, il surveille usbmux et Bonjour.
    this.process = spawn(PYTHON, ['-m', 'pymobiledevice3', 'remote', 'tunneld'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Fallback : Si après 10s on n'a rien trouvé, on tente dns-sd
    this.fallbackTimer = setTimeout(() => this._triggerNativeFallback(), 10000)

    const onData = (data) => {
      const text = data.toString().trim()
      if (!text) return
      dbg(`[tunneld] ${text}`)

      // Format flexible pour capturer IP et Port même avec des prefixes/couleurs
      const matchRsd = text.match(/--rsd\s+([\w:.]+)\s+(\d+)/)
      
      if (matchRsd) {
        const address = matchRsd[1]
        const port = matchRsd[2]
        
        // On cherche l'ID de l'appareil dans toute la ligne (format [start-tunnel-task-usbmux-ID-TYPE])
        const matchId = text.match(/\[start-tunnel-task-usbmux-([^-]+)-(\w+)\]/)
        const typeRaw = matchId ? matchId[2] : ''
        const isUSB = typeRaw.toLowerCase().includes('usb')
        const type = isUSB ? 'USB' : 'WiFi'

        // On a trouvé, on annule le fallback
        if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null }

        dbg(`[tunneld] Connexion détectée : ${type} (${address}:${port})`)
        sendStatus('tunneld', 'active', `iPhone détecté via ${type} (${address}:${port})`)
        this.emit('connection', { address, port, type, id: matchId ? matchId[1] : 'unknown' })
      }

      // Détection d'erreurs fatales
      if (text.toLowerCase().includes('error') && text.includes('usbmux')) {
        this.emit('error', text)
      }
    }

    this.process.stdout.on('data', onData)
    this.process.stderr.on('data', onData)

    this.process.on('exit', (code, signal) => {
      if (this._isQuitting || this.restartTimer) return
      dbg(`[tunneld] Arrêt du processus (code ${code}, signal ${signal})`)
      this.emit('disconnection', 'Démon tunnel arrêté')
      this._scheduleRestart(TUNNEL_RESTART_DELAY)
    })
  }

  async _triggerNativeFallback() {
    if (this._isQuitting) return
    dbg('[tunneld-service] Aucun appareil détecté via tunneld. Test via Bonjour Natif (dns-sd)...')
    sendStatus('tunneld', 'info', 'Recherche approfondie via Bonjour Natif...')
    
    const instances = await nativeBonjour.scan(5000)
    if (instances.length > 0) {
      const data = await nativeBonjour.resolve(instances[0])
      if (data && data.port) {
        const address = data.address || 'fe80::1' // Par défaut on tente le link-local si non extrait
        dbg(`[tunneld-service] Appareil trouvé via fallback ! ${address}:${data.port}`)
        sendStatus('tunneld', 'active', `iPhone forcé via WiFi (${address}:${data.port})`)
        this.emit('connection', { address, port: data.port, type: 'WiFi' })
      }
    } else {
      dbg('[tunneld-service] Échec du fallback natif.')
      sendStatus('tunneld', 'error', 'iPhone non détecté (Vérifiez le WiFi et le câble)')
    }
  }

  _scheduleRestart(delay) {
    if (this._isQuitting || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start()
    }, delay)
  }

  stop() {
    if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.process) {
      this.process.removeAllListeners()
      try { this.process.kill('SIGTERM') } catch (_) {}
      this.process = null
    }
  }

  destroy() {
    this._isQuitting = true
    this.stop()
  }
}

module.exports = TunneldService
