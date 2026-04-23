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
    this.heartbeatRunners = new Map() // udid/rsd -> ProcessRunner
    this.restartTimer = null
    this.fallbackTimer = null
    this.activeConnection = null // { address, port, type, id }
    this.deviceInfo = { name: 'iPhone', version: 'Inconnue', type: 'Inconnu', paired: false, ip: null }
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
    if (this.runner.isRunning && this._manualIp === manualIp) return
    if (this._isStarting) return
    this._isStarting = true

    try {
      if (this.runner.isRunning) {
        this.stop()
        await new Promise(resolve => setTimeout(resolve, 1500))
      }

      this._manualIp = manualIp
      dbg('[tunneld-service] lancement du demon tunneld...')
      sendStatus('tunneld', 'starting', 'Initialisation du demon tunnel...')

      this.runner.spawn(PYTHON, ['-m', 'pymobiledevice3', 'remote', 'tunneld'])

      if (this.fallbackTimer) clearTimeout(this.fallbackTimer)
      this.fallbackTimer = setTimeout(() => this._triggerNativeFallback(this._manualIp), 10000)
    } finally {
      setTimeout(() => { this._isStarting = false }, 2000)
    }
  }

  _handleData(text) {
    if (!text) return

    // Detection d'infos device
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

    // Format flexible pour capturer IP et Port
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
      
      // On lance le heartbeat via RSD pour eviter le prompt "Choose device"
      this._startRsdHeartbeat(address, port, deviceId)

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
  }

  _startRsdHeartbeat(address, port, udid) {
    const key = `${address}:${port}`
    if (this.heartbeatRunners.has(key)) return
    
    dbg(`[tunneld-service] Battement de coeur (RSD) sur ${key}...`)
    
    // On utilise --rsd plutot que --udid pour eviter toute ambiguite/prompt
    const isIPv6 = address.includes(':')
    const formattedHost = isIPv6 ? `[${address}]` : address
    const args = ['-m', 'pymobiledevice3', 'lockdown', 'heartbeat', '--rsd', formattedHost, port]

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
      dbg(`[tunneld-service] Arret heartbeat ${key}`)
      runner.stop()
    }
    this.heartbeatRunners.clear()
  }

  async _triggerNativeFallback(manualIp = null) {
    if (this._isQuitting || this.activeConnection) return
    dbg('[tunneld-service] Fallback Bonjour...')
    
    let targetData = null
    const instances = await nativeBonjour.scan(4000)
    if (instances.length > 0) {
      targetData = await nativeBonjour.resolve(instances[0])
    }

    if (!targetData && manualIp) {
      targetData = await nativeBonjour.resolve({ name: 'Manual', address: manualIp })
    }

    if (targetData && !this.activeConnection) {
      this._handleData(`--rsd ${targetData.address} ${targetData.port} [start-tunnel-task-usbmux-native-WiFi]`)
    } else if (!this.activeConnection) {
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
}

module.exports = TunneldService
