'use strict'

const net = require('net')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const { 
  WIFI_RETRY_DELAY, 
  RSD_DEFAULT_PORT,
  PROBE_PORT_START,
  PROBE_PORT_COUNT,
  PROBE_TIMEOUT,
  PROBE_INTERVAL
} = require('../constants')
const avahiBus = require('./avahi-bus-driver')

/**
 * Gère la connexion WiFi (mDNS ou IP manuelle)
 */
class WifiBus extends EventEmitter {
  constructor() {
    super()
    this.retryTimer = null
    this._isQuitting = false
    this.ipOverride = null
    this.portOverride = null
    this.lastKnownPort = null
    this._isAvahiStarted = false

    // Liaison des événements Avahi
    avahiBus.on('deviceFound', (device) => {
      if (this._isQuitting) return
      dbg(`[wifi-bus] Device trouvé via Avahi : ${device.udid}`)
      this.emit('connection', { 
        address: device.address, 
        port: String(device.port), 
        udid: device.udid,
        type: 'WiFi' 
      })
    })
  }

  setOverrides(ip, port) {
    this.ipOverride = (ip && ip.trim()) ? ip.trim() : null
    this.portOverride = (port && port.trim()) ? port.trim() : null
  }

  scheduleRetry(delay = WIFI_RETRY_DELAY) {
    if (this._isQuitting) return
    
    if (this.retryTimer) {
      if (delay < 1000) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      } else {
        return
      }
    }

    dbg(`[wifi-bus] retry dans ${delay / 1000}s`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.start()
    }, delay)
  }

  async start() {
    if (this._isQuitting) return
    
    // Si on a une IP forcée, on fait une résolution directe "legacy"
    if (this.ipOverride) {
      dbg(`[wifi-bus] Utilisation de l'IP forcée : ${this.ipOverride}`)
      const device = { address: this.ipOverride, port: this.portOverride, manual: true }
      
      let port = device.port || this.lastKnownPort
      
      if (port) {
        const isOpen = await this._isPortOpen(device.address, port)
        if (!isOpen) {
          dbg(`[wifi-bus] port mémorisé ${port} ne répond plus, lancement d'un scan...`)
          port = null 
          this.lastKnownPort = null
        }
      }

      if (!port) {
        sendStatus('tunneld', 'starting', `Scan des ports RSD en cours sur ${device.address}...`)
        port = await this._probePort(device.address)
      }

      if (port) {
        this.emit('connection', { address: device.address, port, type: 'WiFi' })
      } else {
        dbg('[wifi-bus] aucun port trouvé lors du scan')
        this.emit('failure', 'Aucun port RSD trouvé')
        this.scheduleRetry()
      }
      return
    }

    // Sinon, on utilise la découverte Avahi (D-Bus)
    if (!this._isAvahiStarted) {
      dbg('[wifi-bus] Démarrage de la découverte Avahi D-Bus...')
      avahiBus.startDiscovery()
      this._isAvahiStarted = true
    }
  }

  _isPortOpen(ip, port) {
    return new Promise((resolve) => {
      const s = new net.Socket()
      s.setTimeout(800) // Très rapide
      s.on('connect', () => { s.destroy(); resolve(true) })
      s.on('error', () => { s.destroy(); resolve(false) })
      s.on('timeout', () => { s.destroy(); resolve(false) })
      s.connect(port, ip)
    })
  }

  _probePort(ip) {
    const { 
      RSD_DEFAULT_PORT, 
      PROBE_PORT_START, PROBE_PORT_COUNT,
      PROBE_PORT_HIGH_START, PROBE_PORT_HIGH_COUNT,
      PROBE_INTERVAL, PROBE_TIMEOUT 
    } = require('../constants')

    const ports = [
      RSD_DEFAULT_PORT, 
      ...Array.from({ length: PROBE_PORT_COUNT }, (_, i) => PROBE_PORT_START + i),
      ...Array.from({ length: PROBE_PORT_HIGH_COUNT }, (_, i) => PROBE_PORT_HIGH_START + i)
    ]

    return new Promise((resolve) => {
      let finished = false
      const done = (p) => { if (!finished) { finished = true; resolve(p) } }

      ports.forEach((p, i) => {
        setTimeout(() => {
          if (finished) return
          const s = new net.Socket()
          s.setTimeout(PROBE_TIMEOUT)
          s.on('connect', () => { s.destroy(); done(p) })
          s.on('error', () => s.destroy())
          s.on('timeout', () => s.destroy())
          s.connect(p, ip)
        }, i * PROBE_INTERVAL)
      })
      setTimeout(() => done(null), 6000)
    })
  }

  stop() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
  }

  destroy() {
    this._isQuitting = true
    this.stop()
  }
}

module.exports = WifiBus
