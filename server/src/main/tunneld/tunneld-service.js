'use strict'

const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const { PYTHON } = require('../python-resolver')
const { TUNNEL_RESTART_DELAY } = require('../constants')
const ProcessRunner = require('../utils/process-runner')
const nativeBonjour = require('./native-bonjour')

/**
 * TunneldService - Gere le demon pymobiledevice3 remote tunneld
 */
class TunneldService extends EventEmitter {
  constructor() {
    super()
    this.runner = new ProcessRunner('tunneld')
    this.heartbeatRunners = new Map()
    this.restartTimer = null
    this.fallbackTimer = null
    this.activeConnection = null
    this.deviceInfo = { name: 'iPhone', version: 'Inconnue', type: 'Inconnu', paired: false, ip: null }
    this._isQuitting = false
    dbg('[tunneld-service] Initialise - v2.0.1 (No-Brackets)')

    this.runner.on('stdout', (text) => this._handleData(text))
    this.runner.on('stderr', (text) => this._handleData(text))
    this.runner.on('exit', ({ code, signal }) => {
      if (this._isQuitting || this.restartTimer) return
      dbg(`[tunneld] Demon tunnel arrete (code ${code}, signal ${signal})`)
      this.emit('disconnection', 'Demon tunnel arrete')
      this._scheduleRestart(TUNNEL_RESTART_DELAY)
    })
  }

  async start(manualIp = null) {
    if (this._isQuitting) return
    
    // Mise à jour de l'IP manuelle (transite des états) sans tuer le processus
    this._manualIp = manualIp

    if (this.runner.isRunning) {
      if (manualIp && !this.activeConnection) {
        dbg(`[tunneld-service] IP WebSocket reçue (${manualIp}) pendant que le démon tourne. Tentative de fallback...`)
        this._triggerNativeFallback(manualIp)
      }
      return
    }

    if (this._isStarting) return
    this._isStarting = true

    try {
      dbg(`[tunneld-service] Lancement du démon tunneld (Cascade USB/WiFi)...`)
      sendStatus('tunneld', 'starting', 'Initialisation du demon tunnel...')

      // Lancement du processus de base (Priorité 4 / USB / Passive Discovery)
      this.runner.spawn(PYTHON, ['-m', 'pymobiledevice3', 'remote', 'tunneld'])

      if (this.fallbackTimer) clearTimeout(this.fallbackTimer)

      if (manualIp) {
        // Priorité 2 : Si IP déjà là au démarrage, on tente le fallback immédiat
        this._triggerNativeFallback(manualIp)
      } else {
        // Priorité 3 : Attente standard avant fallback Bonjour automatique
        this.fallbackTimer = setTimeout(() => this._triggerNativeFallback(null), 10000)
      }
    } finally {
      setTimeout(() => { this._isStarting = false }, 2000)
    }
  }

  _handleData(text) {
    if (!text) return

    const matchId = text.match(/ID:([\w:.]+)/)
    const matchVer = text.match(/VERSION:([\d.]+)/)
    const matchType = text.match(/TYPE:([^ >]+)/)
    const matchPaired = text.match(/PAIRED:(\w+)/)

    if (matchId || matchVer || matchType || matchPaired) {
      if (matchId) this.deviceInfo.ip = matchId[1]
      if (matchVer) this.deviceInfo.version = matchVer[1]
      if (matchType) this.deviceInfo.type = matchType[1].replace(/[,>]$/, '')
      if (matchPaired) this.deviceInfo.paired = matchPaired[1].toLowerCase().includes('true')
      this.emit('device-info-updated', this.deviceInfo)
    }

    const matchRsd = text.match(/--rsd\s+([\w:.%]+)\s+(\d+)/)
    if (matchRsd) {
      const address = matchRsd[1]
      const port = matchRsd[2]

      const matchIdTask = text.match(/\[start-tunnel-task-usbmux-(.+)-([^-]+)\]/)
      const deviceId = matchIdTask ? matchIdTask[1] : 'native'
      const typeRaw = matchIdTask ? matchIdTask[2] : ''
      const isUSB = typeRaw.toLowerCase().includes('usb')
      const type = isUSB ? 'USB' : 'WiFi'

      if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null }
      if (this.activeConnection && this.activeConnection.address === address && this.activeConnection.port === port) return

      dbg(`[tunneld] Connexion detectee : ${type} (${address}:${port})`)
      // Le heartbeat est maintenant géré par l'orchestrateur via l'IP WebSocket
      // this._startRsdHeartbeat(address, port, deviceId)

      this.activeConnection = { address, port, type, id: deviceId }
      this.emit('connection', this.activeConnection)
      
      sendStatus('tunneld', 'ready', `Tunnel actif (${type}) -> ${address}:${port}`, { 
        type, 
        device: this.deviceInfo 
      })
    }

    if (text.includes('Disconnected from tunnel') || text.includes('Tunnel task failed')) {
      dbg(`[tunneld-service] Deconnexion detectee : ${text}`)
      this._stopAllHeartbeats()
      this.activeConnection = null
      this.emit('disconnection', text)
    }

    // --- GESTION DES ERREURS DE BIND (PORT OCCUPÉ) ---
    if (text.includes('10048')) {
      dbg('[tunneld] ⚠️ Port 49151 déjà utilisé. Tentative de nettoyage forcé...')
      this.stop() // Déclenche le nettoyage ProcessRunner
      this._scheduleRestart(5000) // On attend un peu plus
    }

    // --- GESTION DES ERREURS RÉSEAU (CACHE IPV6 OBSOLÈTE) ---
    if (text.includes('1231')) {
      dbg('[tunneld] ❌ Erreur réseau 1231 (Cible injoignable). Pause de 10s avant nouvelle tentative...')
      this.stop()
      this._scheduleRestart(10000) // On calme le jeu pour laisser mDNS se stabiliser
    }
  }

  _startRsdHeartbeat(address, port, udid) {
    const key = `${address}:${port}`
    if (this.heartbeatRunners.has(key)) return
    
    dbg(`[tunneld-service] Battement de coeur (RSD) sur ${key}...`)
    
    // IMPORT : Sur Windows, l'IPv6 Link-Local avec Scope ID (%xx) ne doit PAS avoir de crochets 
    // si l'hôte et le port sont passés en arguments séparés, sinon pymobiledevice3/python crashe.
    // Mais il DOIT avoir le Scope ID pour être joignable par l'OS.
    const args = ['-m', 'pymobiledevice3', 'lockdown', 'heartbeat', '--rsd', address, port]

    const hbRunner = new ProcessRunner(`hb-${udid.slice(0,8)}`)
    hbRunner.on('stdout', (t) => this._handleData(t))
    hbRunner.spawn(PYTHON, args)
    this.heartbeatRunners.set(key, hbRunner)

    hbRunner.on('exit', () => {
      if (this.heartbeatRunners.get(key) === hbRunner) {
        this.heartbeatRunners.delete(key)
      }
    })
  }

  stop() {
    this.runner.stop()
    this._stopAllHeartbeats()
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.activeConnection = null
  }

  stopHeartbeats() { this._stopAllHeartbeats() }
  destroy() { this._isQuitting = true; this.stop() }

  _stopAllHeartbeats() {
    for (const [key, runner] of this.heartbeatRunners) {
      runner.stop()
    }
    this.heartbeatRunners.clear()
  }

  async _triggerNativeFallback(manualIp = null) {
    if (this._isQuitting || this.activeConnection || this._isResolving) return
    this._isResolving = true
    
    try {
      let targetData = null
      if (manualIp) {
        dbg(`[tunneld-service] Tentative prioritaire sur l'IP detectee (WebSocket) : ${manualIp}...`)
        targetData = await nativeBonjour.resolve({ name: 'Manual', address: manualIp })
      }
      
      if (!targetData) {
        dbg('[tunneld-service] Recherche d\'appareils via Bonjour Natif (dns-sd)...')
        const instances = await nativeBonjour.scan(4000)
        if (instances.length > 0) {
          // PRIORITÉ : On cherche d'abord une instance avec une IP fe80 (Link-Local)
          const bestInstance = instances.find(i => i.address && i.address.startsWith('fe80')) || instances[0]
          targetData = await nativeBonjour.resolve(bestInstance)
        }
      }

      if (targetData && !this.activeConnection) {
        dbg(`[tunneld-service] Solution de secours trouvée : ${targetData.address}:${targetData.port}`)
        this._handleData(`--rsd ${targetData.address} ${targetData.port} [start-tunnel-task-usbmux-native-WiFi]`)
      } else if (!this.activeConnection) {
        this._scheduleRestart(5000)
      }
    } finally {
      this._isResolving = false
    }
  }

  _scheduleRestart(delay) {
    if (this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start(this._manualIp)
    }, delay)
  }
}

module.exports = new TunneldService()
