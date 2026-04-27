'use strict'

const { EventEmitter } = require('events')
const http = require('http')
const path = require('path')
const { dbg, sendStatus } = require('../logger')
const { GOIOS } = require('../goios-resolver')
const ProcessRunner = require('../utils/process-runner')

const TUNNEL_INFO_PORT = 28100  // Port HTTP local exposé par go-ios
const POLL_INTERVAL_MS = 2000   // Interroge l'API go-ios toutes les 2s

/**
 * TunneldService (go-ios) - Gere le daemon "ios tunnel start"
 *
 * Architecture :
 *   - "ios tunnel start" tourne en arrière-plan et crée le tunnel RSD
 *   - go-ios expose une API HTTP locale sur le port 28100
 *   - On interroge cette API toutes les Xs pour récupérer l'adresse RSD
 *   - Une fois l'adresse trouvée, on émet 'connection' et on arrête le polling
 *   - On garde le polling pour détecter les déconnexions
 */
class TunneldService extends EventEmitter {
  constructor() {
    super()
    this.runner = new ProcessRunner('tunneld', { priority: 0 })
    this.activeConnection = null
    this.deviceInfo = { name: 'iPhone', version: 'Inconnue', type: 'USB', paired: true, ip: null }
    this._isQuitting = false
    this._pollTimer = null
    this._restartTimer = null
    this._isStarting = false
    dbg('[tunneld-service] Initialise - go-ios v1.0.211')

    this.runner.on('stdout', (text) => this._handleOutput(text))
    this.runner.on('stderr', (text) => this._handleOutput(text))
    this.runner.on('exit', ({ code, signal }) => {
      if (this._isQuitting || this._isStarting) return
      dbg(`[tunneld] Processus arrete (code ${code}, signal ${signal}). Relance dans 3s...`)
      this._stopPolling()
      this.activeConnection = null
      this.emit('disconnection', 'Processus tunnel arrete')
      this._scheduleRestart(3000)
    })
  }

  async start(udid = null) {
    if (this._isQuitting) return
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null }
    if (this.runner.isRunning || this._isStarting) return

    this._isStarting = true
    dbg('[tunneld-service] Lancement de ios tunnel start...')
    sendStatus('tunneld', 'starting', 'Initialisation du tunnel go-ios...')

    // On s'assure que le port est libre avant de lancer
    await this.runner.stop()

    const goIosDir = path.dirname(GOIOS)
    this.runner.options.cwd = goIosDir

    // Utilisation de stopagent pour être sûr que tout est libéré
    try {
      dbg('[tunneld] Libération préventive du tunnel (stopagent)...')
      const { execSync } = require('child_process')
      execSync(`"${GOIOS}" tunnel stopagent`, { cwd: goIosDir, stdio: 'ignore' })
    } catch (e) {}

    const args = ['tunnel', 'start', '--userspace']
    if (udid) {
      args.push('--udid', udid)
      dbg(`[tunneld] Filtrage sur UDID : ${udid}`)
    }
    dbg(`[tunneld] Commande finale : ${GOIOS} ${args.join(' ')}`)

    this.runner.spawn(GOIOS, args)

    // Début du polling API après 4s (laisser le processus démarrer et se stabiliser)
    setTimeout(() => {
      this._isStarting = false
      this._startPolling()
    }, 4000)
  }

  _handleOutput(text) {
    if (!text || !text.trim()) return
    
    // On affiche tout pour le debug
    dbg(`[tunneld] ${text.trim()}`)
  }

  /**
   * Interroge l'API HTTP locale de go-ios pour connaître l'état du tunnel.
   * Endpoint : GET http://localhost:28100/
   * Réponse JSON : [{ udid, tunnelAddress, tunnelPort, userspace }]
   */
  _startPolling() {
    if (this._pollTimer) return
    dbg('[tunneld-service] Polling API go-ios démarré...')
    this._pollTimer = setInterval(() => this._pollTunnelApi(), POLL_INTERVAL_MS)
    this._pollTunnelApi() // Première vérification immédiate
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  _pollTunnelApi() {
    // On n'utilise plus que /tunnels qui est l'endpoint valide
    this._fetchFromApi('/tunnels')
  }

  _fetchFromApi(path) {
    const req = http.get(`http://127.0.0.1:${TUNNEL_INFO_PORT}${path}`, { timeout: 1500 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          if (body && body !== '[]') {
            // dbg(`[tunneld-service] API ${path} brute : ${body}`)
          }
          
          if (!body || body === '[]') return

          const tunnels = JSON.parse(body)
          if (Array.isArray(tunnels) && tunnels.length > 0) {
            this._handleTunnelList(tunnels)
          }
        } catch (e) { 
           dbg(`[tunneld-service] Erreur parsing API ${path} : ${e.message} (Body: ${body})`)
        }
      })
    })
    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        // Silencieux pour ne pas polluer si l'API n'est pas encore montée
      } else {
        dbg(`[tunneld-service] Erreur HTTP API : ${e.message}`)
      }
    })
    req.on('timeout', () => {
      dbg(`[tunneld-service] Timeout API sur port ${TUNNEL_INFO_PORT}`)
      req.destroy()
    })
  }

  _handleTunnelList(tunnels) {
    // Prend le premier tunnel disponible
    const tunnel = tunnels[0]
    const address = tunnel.tunnelAddress || tunnel.address
    const port = String(tunnel.tunnelPort || tunnel.rsdPort || tunnel.port)
    const udid = tunnel.udid || 'unknown'

    if (!address || !port) return

    // Pas de changement → on ne ré-émet pas
    if (this.activeConnection?.address === address && this.activeConnection?.port === port) return

    // Récupérer les infos du device via go-ios si possible
    this._fetchDeviceInfo(udid)

    const conn = { address, port, type: 'USB', id: udid, deviceInfo: this.deviceInfo }
    this.activeConnection = conn

    dbg(`[tunneld] ✅ Tunnel actif : ${address}:${port} (UDID: ${udid.slice(0, 8)}...)`)
    sendStatus('tunneld', 'ready', `Tunnel go-ios actif → ${address}:${port}`, {
      type: 'USB',
      device: this.deviceInfo
    })

    this.emit('connection', conn)
  }

  _fetchDeviceInfo(udid) {
    // Appel non-bloquant pour récupérer les infos du device
    const req = http.get(`http://127.0.0.1:${TUNNEL_INFO_PORT}/device/${udid}/info`, { timeout: 2000 }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try {
          const info = JSON.parse(body)
          if (info.DeviceName) this.deviceInfo.name = info.DeviceName
          if (info.ProductVersion) this.deviceInfo.version = info.ProductVersion
          if (info.ProductType) this.deviceInfo.type = info.ProductType
          this.deviceInfo.paired = true
          this.emit('device-info-updated', this.deviceInfo)
        } catch (e) { /* ignore */ }
      })
    })
    req.on('error', () => {})
    req.on('timeout', () => req.destroy())
  }

  stop() {
    this._stopPolling()
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null }
    
    const goIosDir = path.dirname(GOIOS)
    try {
      const { execSync } = require('child_process')
      execSync(`"${GOIOS}" tunnel stopagent`, { cwd: goIosDir, stdio: 'ignore' })
    } catch (e) {}
    
    this.runner.stop()
    this.activeConnection = null
  }

  stopHeartbeats() { /* go-ios gère ça en interne */ }
  destroy() { this._isQuitting = true; this.stop() }

  _scheduleRestart(delay) {
    if (this._restartTimer || this._isQuitting) return
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null
      this.start()
    }, delay)
  }
}

module.exports = new TunneldService()
