'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const net = require('net')
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
    this.restorationTimer = null // Nouveau : pour suivre le timer de relance
    this._isQuitting = false
    this._isLaunching = false
    this.currentPort = null
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
        this.emit('location-changed', this.lastCoords)
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

    const rsdPort = this.tunnel.getRsdPort()
    if (!rsdPort) {
      dbg('[gps-sim] tunnel rétabli ? — aucun port RSD valide, annulation restauration')
      return
    }

    if (this.process && !this.process.killed && this.currentPort === rsdPort) {
      dbg('[gps-sim] tunnel rétabli — simulation déjà active sur ce port')
      return
    }

    this.currentPort = rsdPort
    dbg(`[gps-sim] tunnel rétabli (Port: ${rsdPort}) — attente de stabilisation (6s)...`)
    
    if (this.restorationTimer) clearTimeout(this.restorationTimer)

    // Délai de sécurité pour laisser le tunnel se monter correctement dans l'OS
    this.restorationTimer = setTimeout(() => {
      this.restorationTimer = null
      if (this._isQuitting) return
      dbg('[gps-sim] relance simulation automatique')
      this.setLocation(this.lastCoords.lat, this.lastCoords.lon, this.lastCoords.name)
        .then(res => {
          if (res.success) sendStatus('sim-restart', 'ok', 'Reconnexion')
        })
    }, 6000)
  }

  stop() {
    if (this.process) {
      const oldPid = this.process.pid
      dbg(`[gps-sim] Arret du processus PID ${oldPid} en cours...`)
      const procToKill = this.process
      this.process = null // On nullifie AVANT pour que les handlers sachent que c'est nous
      try { procToKill.kill('SIGTERM') } catch (_) {}
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
      
      // Sur Windows/IPv6, pymobiledevice3 préfère l'adresse entre crochets.
      // On détecte l'IPv6 par la présence de plus d'un ':' (pour ne pas confondre avec IPv4:port)
      const isIPv6 = rsdAddress && rsdAddress.split(':').length > 2
      const formattedAddress = isIPv6 ? `[${rsdAddress}]` : rsdAddress

      const args = [
        '-m', 'pymobiledevice3',
        'developer', 'dvt', 'simulate-location', command,
        '--rsd', formattedAddress, rsdPort,
      ]
      if (extraArgs.length > 0) args.push('--', ...extraArgs)

      dbg(`[gps-sim] spawn: ${PYTHON} ${args.join(' ')}`)
      const spawnTime = Date.now()
      
      const proc = spawn(PYTHON, args, {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
      })
      proc.stdout.setEncoding('utf8')
      proc.stderr.setEncoding('utf8')

      if (command === 'set') {
        this.process = proc
        dbg(`[gps-sim] Nouveau processus simulation PID: ${proc.pid}`)
      }

      let stderr = ''
      let resolved = false

      const done = (result) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        resolve(result)
      }

      proc.stdout.on('data', (d) => {
        const msg = d.toString().trim()
        if (msg) {
          dbg(`[gps-sim] [stdout] : ${msg}`)
          this.emit('log', msg)
        }
        const latencyMs = Date.now() - spawnTime
        done({ success: true, latencyMs })
      })

      proc.stderr.on('data', (d) => {
        const msg = d.toString().trim()
        stderr += msg
        
        // Log de flux pour debug
        if (msg) {
          dbg(`[gps-sim] [stderr] : ${msg}`)
          this.emit('log', `Erreur: ${msg}`)
        }
        
        if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
          // Erreurs critiques de tunnel -> on force le refresh global
          const isCritical = msg.includes('ConnectionRefusedError') || 
                            msg.includes('1225') || 
                            msg.includes('1236') || 
                            msg.includes('ConnectionAbortedError') ||
                            msg.includes('ECONNREFUSED');

          if (isCritical) {
            dbg(`[gps-sim] Erreur CRITIQUE de tunnel detectee (${msg.trim()}) -> forceRefresh`)
            if (this.process === proc) this.process = null
            this.tunnel.forceRefresh()
            done({ success: false, error: msg })
          } else {
            // Autres erreurs (ex: developer mode not enabled, etc.) -> on logge mais on ne casse pas le tunnel
            dbg(`[gps-sim] Erreur mineure ou applicative (pas de relance tunnel) : ${msg.trim()}`)
            // On ne fait pas done() ici car le processus pourrait continuer ou se terminer tout seul
          }
        }
      })

      proc.on('exit', (code, signal) => {
        const isUnexpected = !this._isQuitting && code !== 0 && code !== null
        dbg(`[gps-sim] Processus simulation PID ${proc.pid} arrete (code: ${code}, signal: ${signal}) ${isUnexpected ? '!!! CRASH/ARRET INATTENDU !!!' : ''}`)
        
        if (this.process === proc) {
          this.process = null
          if (isUnexpected) {
            this.onTunnelRestored() // Tentative de restauration immédiate
          }
        }
        if (!resolved) {
          done({ success: code === 0, error: stderr || `Exit ${code}` })
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
    this.watchdogTimer = setInterval(async () => {
      if (!this.lastCoords || this._isQuitting) return

      const rsdAddress = this.tunnel.getRsdAddress()
      const rsdPort = this.tunnel.getRsdPort()
      if (!rsdAddress) return

      // Si le processus semble vivant, on fait un "test de santé" (heartbeat actif)
      if (this.process && !this.process.killed) {
        const isAlive = await this._checkHealth(rsdAddress, rsdPort)
        if (isAlive) return
        dbg('[gps-sim] watchdog: processus zombie détecté (échec rsd-info) — nettoyage et relance')
        this.stop() // On tue le zombie
        this.currentPort = null // On force l'oubli du port actuel
      } else {
        dbg('[gps-sim] watchdog: processus mort détecté — vérification du tunnel...')
      }

      // Si le tunnel manager n'a plus de port valide, inutile de tenter une restauration immédiate
      if (!rsdPort) {
        dbg('[gps-sim] watchdog: tunnel déconnecté — attente du signal de rétablissement...')
        this.tunnel.forceRefresh() // On aide un peu le manager
        return
      }

      this.onTunnelRestored()
    }, WATCHDOG_INTERVAL)
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

  _stopWatchdog() {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null }
  }
}

module.exports = GpsSimulator
