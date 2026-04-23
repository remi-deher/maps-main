'use strict'

const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const { PYTHON } = require('../python-resolver')
const { TUNNEL_RESTART_DELAY } = require('../constants')
const ProcessRunner = require('../utils/process-runner')
const nativeBonjour = require('./native-bonjour')

/**
 * TunneldService - Gere le demon pymobiledevice3 remote tunneld
 * Supporte USB et WiFi via une decouverte unifiee.
 */
class TunneldService extends EventEmitter {
  constructor() {
    super()
    this.runner = new ProcessRunner('tunneld')
    this.heartbeatRunners = new Map() // udid -> ProcessRunner
    this.restartTimer = null
    this.fallbackTimer = null
    this.activeConnection = null // { address, port, type, id }
    this.deviceInfo = { name: 'iPhone', version: 'Inconnue', type: 'Inconnu', paired: false }
    this._isQuitting = false

    // Liaison avec le runner principal
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
    
    // Eviter les relances inutiles si deja en cours avec la meme IP
    if (this.runner.isRunning && this._manualIp === manualIp) {
      dbg('[tunneld-service] deja en cours d\'execution avec cette configuration, ignore le redemarrage')
      return
    }

    if (this._isStarting) return
    this._isStarting = true

    try {
      if (this.runner.isRunning) {
        dbg('[tunneld-service] arret de l\'instance precedente...')
        this.stop()
        // Laisser 1.5s pour que Windows libere le socket (fix Errno 10048)
        await new Promise(resolve => setTimeout(resolve, 1500))
      }

      this._manualIp = manualIp
      dbg('[tunneld-service] lancement du demon tunneld...')
      sendStatus('tunneld', 'starting', 'Initialisation du demon tunnel...')

      this.runner.spawn(PYTHON, ['-m', 'pymobiledevice3', 'remote', 'tunneld'])

      if (this.fallbackTimer) clearTimeout(this.fallbackTimer)
      this.fallbackTimer = setTimeout(() => this._triggerNativeFallback(this._manualIp), 10000)
    } finally {
      // Deverrouillage apres un court delai
      setTimeout(() => { this._isStarting = false }, 2000)
    }
  }

  _handleData(text) {
    if (!text) return

    // Detection d'infos device (TcpLockdownClient ou autre prompt)
    // Format: <TcpLockdownClient ID:192.168.1.105 VERSION:26.5 TYPE:iPhone17,2 PAIRED:False>
    const matchInfo = text.match(/VERSION:([\d.]+) TYPE:([^\s,>]+) PAIRED:(\w+)/)
    if (matchInfo) {
      this.deviceInfo.version = matchInfo[1]
      this.deviceInfo.type = matchInfo[2]
      this.deviceInfo.paired = matchInfo[3].toLowerCase() === 'true'
      this.emit('device-info-updated', this.deviceInfo)
    }

    // Format flexible pour capturer IP et Port (incluant le % pour le scope ID IPv6)
    const matchRsd = text.match(/--rsd\s+([\w:.%]+)\s+(\d+)/)
    
    if (matchRsd) {
      const address = matchRsd[1]
      const port = matchRsd[2]

      const matchId = text.match(/\[start-tunnel-task-usbmux-(.+)-([^-]+)\]/)
      const deviceId = matchId ? matchId[1] : 'unknown'
      const typeRaw = matchId ? matchId[2] : ''
      
      const isUSB = typeRaw.toLowerCase().includes('usb')
      const type = isUSB ? 'USB' : 'WiFi'

      if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null }

      if (this.activeConnection && this.activeConnection.address === address && this.activeConnection.port === port) return

      dbg(`[tunneld] Connexion detectee : ${type} (${address}:${port})`)
      
      this._startHeartbeat(deviceId, type === 'WiFi')

      this.activeConnection = { address, port, type, id: deviceId }
      this.emit('connection', this.activeConnection)

      // Mise a jour du statut avec infos device
      sendStatus('tunneld', 'ready', `Tunnel actif (${type}) -> ${address}:${port}`, { 
        type, 
        device: this.deviceInfo 
      })
    }

    // Detection de deconnexion
    if (text.includes('Disconnected from tunnel') || 
        text.includes('terminating') || 
        text.includes('Tunnel task failed')) {
      dbg(`[tunneld-service] !!! DECONNEXION DETECTEE !!! Motif : ${text}`)
      this._stopAllHeartbeats()
      this.activeConnection = null
      this.emit('disconnection', text)
    }
  }

  stop() {
    this.runner.stop()
    this._stopAllHeartbeats()
    if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    this.activeConnection = null
  }

  stopHeartbeats() {
    this._stopAllHeartbeats()
  }

  destroy() {
    this._isQuitting = true
    this.stop()
  }

  _startHeartbeat(udid, isWiFi) {
    if (this.heartbeatRunners.has(udid)) return
    
    dbg(`[tunneld-service] Demarrage du battement de coeur (heartbeat) pour ${udid}...`)
    const args = ['-m', 'pymobiledevice3', 'lockdown', 'heartbeat', '--udid', udid]
    if (isWiFi) args.push('--mobdev2')

    const hbRunner = new ProcessRunner(`hb-${udid.slice(0,8)}`)
    
    // On ecoute aussi les sorties du heartbeat pour choper les infos device
    hbRunner.on('stdout', (t) => this._handleData(t))
    
    hbRunner.spawn(PYTHON, args)
    this.heartbeatRunners.set(udid, hbRunner)

    hbRunner.on('exit', () => {
      if (this.heartbeatRunners.get(udid) === hbRunner) {
        this.heartbeatRunners.delete(udid)
      }
    })
  }

  _stopAllHeartbeats() {
    for (const [udid, runner] of this.heartbeatRunners) {
      dbg(`[tunneld-service] Arret heartbeat pour ${udid}`)
      runner.stop()
    }
    this.heartbeatRunners.clear()
  }

  async _triggerNativeFallback(manualIp = null) {
    if (this._isQuitting || this.activeConnection) return
    dbg('[tunneld-service] Aucun appareil detecte via tunneld. Test via Bonjour Natif (dns-sd)...')
    sendStatus('tunneld', 'info', 'Recherche approfondie via Bonjour Natif...')
    
    let targetData = null
    const instances = await nativeBonjour.scan(5000)
    
    if (instances.length > 0) {
      const instance = instances[0]
      dbg(`[tunneld-service] Tentative de resolution de ${instance.name}...`)
      targetData = await nativeBonjour.resolve(instance)
    }

    if (!targetData && manualIp) {
      dbg(`[tunneld-service] Tentative manuelle sur l'IP : ${manualIp}...`)
      targetData = await nativeBonjour.resolve({ name: 'Manual', address: manualIp })
    }

    if (targetData && !this.activeConnection) {
      dbg(`[tunneld-service] Succes via Fallback : ${targetData.address}:${targetData.port}`)
      this._handleData(`--rsd ${targetData.address} ${targetData.port} [start-tunnel-task-usbmux-native-WiFi]`)
    } else if (!this.activeConnection) {
      dbg('[tunneld-service] Echec fallback. Relance du cycle dans 5s...')
      this._scheduleRestart(5000)
    }
  }

  _scheduleRestart(delay) {
    if (this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start(this._manualIp)
    }, delay)
  }

  get isRunning() {
    return this.runner.isRunning
  }
}

module.exports = TunneldService
