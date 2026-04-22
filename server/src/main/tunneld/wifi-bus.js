'use strict'

const { spawn } = require('child_process')
const net = require('net')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const { PYTHON } = require('../python-resolver')
const { 
  WIFI_RETRY_DELAY, 
  WIFI_SCAN_TIMEOUT, 
  RSD_DEFAULT_PORT,
  PROBE_PORT_START,
  PROBE_PORT_COUNT,
  PROBE_TIMEOUT,
  PROBE_INTERVAL
} = require('../constants')

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
    this.stop()

    const device = await this._resolveAddress()
    if (!device) {
      const msg = this.ipOverride ? `IP manuelle (${this.ipOverride}) inaccessible` : 'iPhone non trouvé sur le réseau'
      dbg(`[wifi-bus] ${msg}`)
      this.emit('failure', msg)
      this.scheduleRetry()
      return
    }

    if (device.manual) {
      let port = device.port || this.lastKnownPort
      
      // Smart Verification: si on a un port, on vérifie s'il répond vraiment
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
    } else {
      // mDNS case - we use the discovered port
      this.emit('connection', { address: device.address, port: device.port, type: 'WiFi' })
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

  async _resolveAddress() {
    if (this.ipOverride) {
      return { address: this.ipOverride, port: this.portOverride, manual: true }
    }
    return this._discoverMdns()
  }

  _discoverMdns() {
    return new Promise((resolve) => {
      dbg('[wifi-bus] recherche mDNS (20s scan)...')
      const proc = spawn(PYTHON, ['-u', '-m', 'pymobiledevice3', 'remote', 'browse', '--timeout', '20'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })

      let output = ''
      let resolved = false
      const done = (val) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        try { proc.kill() } catch (_) {}
        resolve(val)
      }

      const onData = (d) => {
        output += d.toString()
        try {
          const json = JSON.parse(output)
          const wifi = Array.isArray(json) ? json : (json.wifi || [])
          if (wifi.length > 0) {
            done({ address: wifi[0].address, port: String(wifi[0].port), manual: false })
          }
        } catch (_) {}
        const match = output.match(/(?:address['":\s=]+|--rsd\s+)([\d.]+).+?(?:port['":\s=]+|--rsd\s+[\d.]+\s+)(\d+)/si)
        if (match) done({ address: match[1], port: match[2], manual: false })
      }

      proc.stdout.on('data', onData)
      proc.stderr.on('data', onData)
      proc.on('exit', () => done(null))
      const timer = setTimeout(() => done(null), WIFI_SCAN_TIMEOUT)
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
