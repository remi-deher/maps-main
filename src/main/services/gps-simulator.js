'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const { PYTHON } = require('../python-resolver')
const { GPS_SEND_TIMEOUT, WATCHDOG_INTERVAL } = require('../constants')

/**
 * Gère le service de simulation GPS (pymobiledevice3 developer dvt)
 */
class GpsSimulator extends EventEmitter {
  constructor(tunnelManager) {
    super()
    this.tunnel = tunnelManager
    this.process = null
    this.lastCoords = null
    this.watchdogTimer = null
    this._isQuitting = false
  }

  async setLocation(lat, lon, name = null) {
    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()

    if (!rsdAddress || !rsdPort) {
      throw new Error('Tunnel non disponible. iPhone connecté ?')
    }

    this.stop() // Tuer l'ancienne simulation

    const result = await this._spawn('set', [String(lat), String(lon)])
    if (result.success) {
      this.lastCoords = { lat, lon, name }
      this._startWatchdog()
    }
    return result
  }

  async clearLocation() {
    this.stop()
    this._stopWatchdog()
    this.lastCoords = null

    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()
    if (!rsdAddress || !rsdPort) return { success: true }

    return this._spawn('clear')
  }

  onTunnelRestored() {
    if (!this.lastCoords) {
      dbg('[gps-sim] tunnel rétabli — aucune simulation à restaurer')
      return
    }

    if (this.process && !this.process.killed) {
      dbg('[gps-sim] tunnel rétabli — simulation déjà active')
      return
    }

    dbg('[gps-sim] tunnel rétabli — relance simulation automatique')
    this.setLocation(this.lastCoords.lat, this.lastCoords.lon, this.lastCoords.name)
      .then(res => {
        if (res.success) sendStatus('sim-restart', 'ok', 'Reconnexion')
      })
  }

  stop() {
    if (this.process) {
      try { this.process.kill('SIGTERM') } catch (_) {}
      this.process = null
    }
  }

  destroy() {
    this._isQuitting = true
    this._stopWatchdog()
    this.stop()
    this.lastCoords = null
  }

  // ─── Privé ───────────────────────────────────────────────────────────────────

  async _spawn(command, extraArgs = []) {
    return new Promise((resolve) => {
      const rsdAddress = this.tunnel.getRsdAddress()
      const rsdPort = this.tunnel.getRsdPort()

      const args = [
        '-m', 'pymobiledevice3',
        'developer', 'dvt', 'simulate-location', command,
        '--rsd', rsdAddress, rsdPort,
      ]
      if (extraArgs.length > 0) args.push('--', ...extraArgs)

      dbg(`[gps-sim] spawn: ${PYTHON} ${args.join(' ')}`)
      const spawnTime = Date.now()
      const proc = spawn(PYTHON, args)
      if (command === 'set') this.process = proc

      let stderr = ''
      let resolved = false

      const done = (result) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        resolve(result)
      }

      proc.stdout.on('data', (d) => {
        const latencyMs = Date.now() - spawnTime
        done({ success: true, latencyMs })
      })

      proc.stderr.on('data', (d) => {
        stderr += d.toString()
        if (stderr.toLowerCase().includes('error') || stderr.toLowerCase().includes('failed')) {
          if (this.process === proc) this.process = null

          // Si c'est une erreur de connexion (Port mort / RSD expiré)
          if (stderr.includes('ConnectionRefusedError') || stderr.includes('1225') || stderr.includes('ECONNREFUSED')) {
            dbg('[gps-sim] erreur de connexion détectée -> demande de rafraîchissement au tunnel...')
            this.tunnel.forceRefresh()
          }

          done({ success: false, error: stderr })
        }
      })

      proc.on('exit', (code) => {
        if (this.process === proc) this.process = null
        if (!resolved) {
          const hasError = stderr.toLowerCase().includes('error') || stderr.toLowerCase().includes('failed')
          
          if (code === 0 && !hasError) {
            done({ success: true })
          } else {
            // Analyse de l'erreur sur l'exit aussi
            if (stderr.includes('ConnectionRefusedError') || stderr.includes('1225') || code === 1) {
               // On pourrait refresh ici aussi mais stderr l'a probablement déjà fait
            }
            done({ success: false, error: stderr || `Exit ${code}` })
          }
        }
      })

      const timer = setTimeout(() => {
        if (this.process === proc) this.process = null
        try { proc.kill() } catch (_) {}
        done({ success: false, error: 'Timeout' })
      }, GPS_SEND_TIMEOUT)
    })
  }

  _startWatchdog() {
    this._stopWatchdog()
    this.watchdogTimer = setInterval(() => {
      if (!this.lastCoords || this._isQuitting) return
      if (this.process && !this.process.killed) return

      // Si le tunnel est dispo mais process mort -> relance
      if (this.tunnel.getRsdAddress()) {
        dbg('[gps-sim] watchdog: crash détecté — relance')
        this.onTunnelRestored()
      }
    }, WATCHDOG_INTERVAL)
  }

  _stopWatchdog() {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null }
  }
}

module.exports = GpsSimulator
