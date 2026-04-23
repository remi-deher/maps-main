'use strict'

const { EventEmitter } = require('events')
const { dbg } = require('../../logger')
const { PYTHON } = require('../../python-resolver')
const ProcessRunner = require('../../utils/process-runner')

/**
 * UsbConnector - Gère spécifiquement la connexion USB via pymobiledevice3
 */
class UsbConnector extends EventEmitter {
  constructor() {
    super()
    this.runner = new ProcessRunner('usb-tunnel')
    this.deviceInfo = null
    this.activeConnection = null
    this._isQuitting = false

    this.runner.on('stdout', (text) => this._handleData(text))
    this.runner.on('stderr', (text) => this._handleData(text))
  }

  start() {
    if (this.runner.isRunning || this._isQuitting) return
    dbg('[usb-connector] Lancement du tunnel USB...')
    // pymobiledevice3 remote tunneld gère nativement le switch USB/WiFi, 
    // mais ici on va filtrer les événements pour ne garder que l'USB.
    this.runner.spawn(PYTHON, ['-m', 'pymobiledevice3', 'remote', 'tunneld'])
  }

  _handleData(text) {
    if (!text) return

    // Detection device info (ID, VERSION, TYPE, PAIRED)
    const matchId = text.match(/ID:([\w:.]+)/)
    const matchVer = text.match(/VERSION:([\d.]+)/)
    const matchType = text.match(/TYPE:([^ >]+)/)
    const matchPaired = text.match(/PAIRED:(\w+)/)

    if (matchId || matchVer || matchType || matchPaired) {
      this.deviceInfo = { ...this.deviceInfo }
      if (matchId) this.deviceInfo.ip = matchId[1]
      if (matchVer) this.deviceInfo.version = matchVer[1]
      if (matchType) this.deviceInfo.type = matchType[1].replace(/[,>]$/, '')
      if (matchPaired) this.deviceInfo.paired = matchPaired[1].toLowerCase().includes('true')
    }

    // Capture du RSD uniquement si c'est de l'USB
    const matchRsd = text.match(/--rsd\s+([\w:.%]+)\s+(\d+)/)
    if (matchRsd) {
      const address = matchRsd[1]
      const port = matchRsd[2]
      
      // On vérifie si c'est de l'USB via le nom de la tâche tunneld
      const isUSB = text.includes('usbmux') || text.includes('usb')
      
      if (isUSB) {
        if (this.activeConnection?.address === address && this.activeConnection?.port === port) return
        
        dbg(`[usb-connector] Connexion USB detectee : ${address}:${port}`)
        this.activeConnection = { address, port, type: 'USB' }
        this.emit('connection', { ...this.activeConnection, deviceInfo: this.deviceInfo })
      }
    }

    if (text.includes('Disconnected from tunnel') || text.includes('Tunnel task failed')) {
      if (this.activeConnection) {
        dbg('[usb-connector] Deconnexion USB')
        this.activeConnection = null
        this.emit('disconnection')
      }
    }
  }

  stop() {
    this.runner.stop()
    this.activeConnection = null
    this.deviceInfo = null
  }

  destroy() {
    this._isQuitting = true
    this.stop()
  }
}

module.exports = UsbConnector
