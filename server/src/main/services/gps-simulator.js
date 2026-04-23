'use strict'

const { EventEmitter } = require('events')
const net = require('net')
const { dbg, sendStatus } = require('../logger')
const { PYTHON } = require('../python-resolver')
const ProcessRunner = require('../utils/process-runner')
const { GPS_SEND_TIMEOUT, WATCHDOG_INTERVAL } = require('../constants')

/**
 * Gere le service de simulation GPS (pymobiledevice3 developer dvt)
 */
class GpsSimulator extends EventEmitter {
  constructor(tunnelManager) {
    super()
    this.tunnel = tunnelManager
    this.runner = new ProcessRunner('gps-sim')
    this.lastCoords = null
    this.watchdogTimer = null
    this.restorationTimer = null
    this._isQuitting = false
    this._isLaunching = false
    this.currentPort = null

    this.runner.on('log', (msg) => this.emit('log', msg))
    this.runner.on('critical-error', (msg) => {
      dbg(`[gps-sim] Erreur CRITIQUE detectee (${msg}) -> forceRefresh`)
      this.tunnel.forceRefresh()
    })

    this.runner.on('exit', ({ code, signal }) => {
      if (this._isQuitting) return
      dbg(`[gps-sim] Processus simulation arrete (code: ${code}, signal: ${signal})`)
      if (code !== 0 && code !== null) this.onTunnelRestored() 
    })
  }

  async setLocation(lat, lon, name = null) {
    if (this._isLaunching) return { success: false, error: 'Already launching' }
    if (this.restorationTimer) {
      this.lastCoords = { lat, lon, name }
      return { success: false, error: 'Tunnel stabilizing, queued' }
    }

    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()

    if (!rsdAddress || !rsdPort) {
      this.lastCoords = { lat, lon, name }
      return { success: false, error: 'Tunnel not ready, queued' }
    }

    this._isLaunching = true
    try {
      this.stop()
      const result = await this._spawn('set', [String(lat), String(lon)])
      if (result.success) {
        this.lastCoords = { lat, lon, name }
        this.currentPort = rsdPort
        this.emit('location-changed', { lat, lon, name })
        this._startWatchdog()
      }
      return result
    } finally {
      this._isLaunching = false
    }
  }

  async clearLocation() {
    this.stop(); this._stopWatchdog(); this.lastCoords = null; this.currentPort = null
    return await this._spawn('clear')
  }

  onTunnelRestored() {
    if (!this.lastCoords || this._isQuitting || this.restorationTimer) return
    dbg('[gps-sim] tunnel retabli - attente de stabilisation (6s)...')
    this.restorationTimer = setTimeout(async () => {
      this.restorationTimer = null
      if (this.lastCoords && !this._isQuitting) {
        const { lat, lon, name } = this.lastCoords
        await this.setLocation(lat, lon, name)
      }
    }, 6000)
  }

  stop() { this.runner.stop() }
  destroy() { this._isQuitting = true; this._stopWatchdog(); this.stop(); this.lastCoords = null }

  async _spawn(command, extraArgs = []) {
    return new Promise((resolve) => {
      const rsdAddress = this.tunnel.getRsdAddress()
      const rsdPort = this.tunnel.getRsdPort()
      
      // IMPORT : Sur Windows, l'IPv6 Link-Local avec Scope ID (%xx) ne doit PAS avoir de crochets 
      // si l'hôte et le port sont passés en arguments séparés.
      const args = [
        '-m', 'pymobiledevice3',
        'developer', 'dvt', 'simulate-location', command,
        '--rsd', rsdAddress, rsdPort,
      ]
      if (extraArgs.length > 0) args.push('--', ...extraArgs)

      const spawnTime = Date.now()
      const proc = this.runner.spawn(PYTHON, args)

      let stderr = ''
      let resolved = false

      const done = (result) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        resolve(result)
      }

      proc.stdout.on('data', (d) => {
        const text = d.toString()
        if (text.includes('Press ENTER') || text.includes('Control-C')) {
          done({ success: true, latencyMs: Date.now() - spawnTime })
        }
      })

      proc.stderr.on('data', (d) => {
        stderr += d.toString()
      })

      const timer = setTimeout(() => {
        if (!resolved) {
          if (this.runner.isRunning) done({ success: true, latencyMs: GPS_SEND_TIMEOUT })
          else done({ success: false, error: stderr || 'Timeout' })
        }
      }, GPS_SEND_TIMEOUT)

      proc.on('exit', (code) => {
        if (!resolved) {
          done({ success: code === 0, error: stderr || `Exit ${code}` })
        }
      })
    })
  }

  _startWatchdog() {
    this._stopWatchdog()
    this.watchdogTimer = setInterval(async () => {
      if (!this.lastCoords || this._isQuitting) return
      const rsdAddress = this.tunnel.getRsdAddress()
      const rsdPort = this.tunnel.getRsdPort()
      if (!rsdAddress) return

      if (this.runner.isRunning) {
        const isAlive = await this._checkHealth(rsdAddress, rsdPort)
        if (isAlive) return
        this.stop()
      }
      this.onTunnelRestored()
    }, WATCHDOG_INTERVAL)
  }

  _stopWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    if (this.restorationTimer) clearTimeout(this.restorationTimer)
    this.watchdogTimer = null
    this.restorationTimer = null
  }

  async _checkHealth(address, port) {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      const timer = setTimeout(() => { socket.destroy(); resolve(false) }, 2000)
      socket.on('error', () => { clearTimeout(timer); socket.destroy(); resolve(false) })
      socket.connect(port, address, () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    })
  }
}

module.exports = GpsSimulator
