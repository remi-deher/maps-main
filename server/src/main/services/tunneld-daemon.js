'use strict'

const { PYTHON } = require('../python-resolver')
const ProcessRunner = require('../utils/process-runner')
const { dbg } = require('../logger')
const { EventEmitter } = require('events')

/**
 * TunneldDaemon - G\u00e8re l'instance unique du d\u00e9mon tunneld et analyse ses sorties
 */
class TunneldDaemon extends EventEmitter {
  constructor() {
    super()
    this.runner = new ProcessRunner('tunneld-daemon', { priority: -5 })
    this.isReady = false
    this.deviceInfo = {}

    this.runner.on('stdout', (msg) => this._handleOutput(msg))
    this.runner.on('stderr', (msg) => this._handleOutput(msg))
  }

  async start() {
    if (this.runner.isRunning) return
    await this.stop()
    dbg('[tunneld-daemon] Lancement du demon global...')
    
    const settings = require('./settings-manager')
    const args = ['-m', 'pymobiledevice3', 'remote', 'tunneld']
    
    // Si go-ios est le driver préféré pour l'USB, on demande à PMD3 d'ignorer l'USB
    // pour éviter les conflits de ports locaux (bind error 60106)
    if (settings.get('usbDriver') === 'go-ios') {
      args.push('--no-usbmux') 
    }
    
    this.runner.spawn(PYTHON, args)
  }

  _handleOutput(text) {
    if (!text) return

    if (text.includes('Uvicorn running on')) {
      this.isReady = true
      dbg('[tunneld-daemon] Demon pret.')
    }

    // Detection device info
    const matchId = text.match(/ID:([\w:.]+)/)
    const matchVer = text.match(/VERSION:([\d.]+)/)
    const matchType = text.match(/TYPE:([^ >]+)/)
    if (matchId || matchVer || matchType) {
      if (matchId) this.deviceInfo.ip = matchId[1]
      if (matchVer) this.deviceInfo.version = matchVer[1]
      if (matchType) this.deviceInfo.type = matchType[1].replace(/[,>]$/, '')
    }

    // Capture du RSD avec filtrage IPv6
    const matchRsd = text.match(/--rsd\s+([\w:.%]+)\s+(\d+)/)
    if (matchRsd) {
      let address = matchRsd[1]
      const port = matchRsd[2]
      
      // Détection plus fine du type de connexion
      // ::1 ou 127.0.0.1 => Forcément USB (via usbmuxd local bridge)
      // Si la ligne contient 'usbmux' juste à côté du RSD => USB
      const isLoopback = address === '::1' || address === '127.0.0.1'
      const hasUsbContext = text.toLowerCase().includes('usbmux') || text.toLowerCase().includes('-usb')
      const isUSB = isLoopback || (hasUsbContext && !text.toLowerCase().includes('wifi'))

      address = address.replace(/%[0-9]+$/, '') // Enlever le scope ID IPv6

      const typeLabel = isUSB ? 'USB' : 'WiFi'
      dbg(`[tunneld-daemon] Connexion détectée : ${address}:${port} (${typeLabel})`)
      
      this.emit('connection', {
        address,
        port,
        type: typeLabel,
        deviceInfo: { ...this.deviceInfo }
      })
    }

    if (text.includes('Disconnected from tunnel') || text.includes('Tunnel task failed')) {
      this.emit('disconnection')
    }
  }

  stop() {
    this.runner.stop()
    this.isReady = false
    this.deviceInfo = {}
  }
}

module.exports = new TunneldDaemon()
