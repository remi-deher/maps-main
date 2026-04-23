'use strict'

const { EventEmitter } = require('events')
const net = require('net')
const { dbg, sendStatus } = require('../logger')
const { PYTHON } = require('../python-resolver')
const ProcessRunner = require('../utils/process-runner')
const { GPS_SEND_TIMEOUT, WATCHDOG_INTERVAL } = require('../constants')

/**
 * Gère le service de simulation GPS (pymobiledevice3 developer dvt)
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

    // Liaison avec le runner
    this.runner.on('log', (msg) => this.emit('log', msg))
    this.runner.on('critical-error', (msg) => {
      dbg(`[gps-sim] Erreur CRITIQUE de tunnel detectee (${msg}) -> forceRefresh`)
      this.tunnel.forceRefresh()
    })

    this.runner.on('exit', ({ code, signal }) => {
      if (this._isQuitting) return
      const isUnexpected = code !== 0 && code !== null
      dbg(`[gps-sim] Processus simulation arrete (code: ${code}, signal: ${signal}) ${isUnexpected ? '!!! CRASH/ARRET INATTENDU !!!' : ''}`)
      
      if (isUnexpected) {
        this.onTunnelRestored() // Tentative de restauration immédiate
      }
    })
  }

  async setLocation(lat, lon, name = null) {
    if (this._isLaunching) {
      dbg('[gps-sim] Simulation deja en cours de lancement (lock active)')
      return { success: false, error: 'Already launching' }
    }

    if (this.restorationTimer) {
      dbg('[gps-sim] Tunnel en cours de stabilisation — position mise en attente')
      this.lastCoords = { lat, lon, name }
      return { success: false, error: 'Tunnel stabilizing, queued' }
    }

    const rsdAddress = this.tunnel.getRsdAddress()
    const rsdPort = this.tunnel.getRsdPort()

    if (!rsdAddress || !rsdPort) {
      dbg('[gps-sim] Tunnel non prêt — position mise en attente pour le rétablissement')
      this.lastCoords = { lat, lon, name }
      return { success: false, error: 'Tunnel not ready, queued' }
    }

    this._isLaunching = true
    try {
      this.stop() // Tuer l'ancienne simulation
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
    this.stop()
    this._stopWatchdog()
    this.lastCoords = null
    this.currentPort = null
    return await this._spawn('clear')
  }

  onTunnelRestored() {
    if (!this.lastCoords || this._isQuitting || this.restorationTimer) return

    // On évite de relancer en boucle si le tunnel saute toutes les secondes
    dbg('[gps-sim] tunnel rétabli — attente de stabilisation (6s)...')
    this.restorationTimer = setTimeout(async () => {
      this.restorationTimer = null
      if (this.lastCoords && !this._isQuitting) {
        dbg('[gps-sim] relance simulation automatique')
        const { lat, lon, name } = this.lastCoords
        await this.setLocation(lat, lon, name)
      }
    }, 6000)
  }

  stop() {
    this.runner.stop()
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
      const isIPv6 = rsdAddress && rsdAddress.split(':').length > 2
      const formattedAddress = isIPv6 ? `[${rsdAddress}]` : rsdAddress

      const args = [
        '-m', 'pymobiledevice3',
        'developer', 'dvt', 'simulate-location', command,
        '--rsd', formattedAddress, rsdPort,
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

      proc.stdout.on('data', () => {
        const latencyMs = Date.now() - spawnTime
        done({ success: true, latencyMs })
      })

      proc.stderr.on('data', (d) => {
        stderr += d.toString()
        if (stderr.toLowerCase().includes('error') || stderr.toLowerCase().includes('failed')) {
           if (stderr.length > 200) done({ success: false, error: stderr.slice(-200) })
        }
      })

      const timer = setTimeout(() => {
        done({ success: false, error: 'Timeout' })
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

      // Si le processus semble vivant, on fait un "test de santé" (heartbeat actif)
      if (this.runner.isRunning) {
        const isAlive = await this._checkHealth(rsdAddress, rsdPort)
        if (isAlive) return
        dbg('[gps-sim] watchdog: processus zombie détecté (échec rsd-info) — nettoyage et relance')
        this.stop() // On tue le zombie
        this.currentPort = null 
      } else {
        dbg('[gps-sim] watchdog: processus mort détecté — vérification du tunnel...')
      }

      if (!rsdPort) {
        dbg('[gps-sim] watchdog: tunnel déconnecté — attente du signal de rétablissement...')
        this.tunnel.forceRefresh() 
        return
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
      
      const timer = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 2000)

      socket.on('error', (err) => {
        clearTimeout(timer)
        socket.destroy()
        dbg(`[gps-sim] Test de sante TCP echoue sur ${address}:${port} : ${err.message}`)
        resolve(false)
      })

      socket.connect(port, address, () => {
        clearTimeout(timer)
        socket.destroy()
        resolve(true)
      })
    })
  }
}

module.exports = GpsSimulator
