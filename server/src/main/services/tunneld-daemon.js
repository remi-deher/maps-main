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

    // Capture du RSD
    const matchRsd = text.match(/--rsd\s+([\w:.%]+)\s+(\d+)/)
    if (matchRsd) {
      const address = matchRsd[1]
      const port = matchRsd[2]
      const isUSB = text.includes('usbmux') || text.includes('usb')
      
      this.emit('connection', {
        address,
        port,
        type: isUSB ? 'USB' : 'WiFi (Tunnel)',
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
