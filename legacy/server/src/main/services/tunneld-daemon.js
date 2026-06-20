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
    const lines = text.split(/\r?\n/)

    lines.forEach(line => {
      if (!line.trim()) return

      if (line.includes('Uvicorn running on')) {
        this.isReady = true
        dbg('[tunneld-daemon] Demon pret.')
      }

      // Detection device info
      const matchId = line.match(/ID:([\w:.]+)/)
      const matchVer = line.match(/VERSION:([\d.]+)/)
      const matchType = line.match(/TYPE:([^ >]+)/)
      if (matchId || matchVer || matchType) {
        if (matchId) this.deviceInfo.ip = matchId[1]
        if (matchVer) this.deviceInfo.version = matchVer[1]
        if (matchType) this.deviceInfo.type = matchType[1].replace(/[,>]$/, '')
      }

      // Capture du RSD avec filtrage IPv6 et détection stricte par ligne
      const matchRsd = line.match(/(?:\[(USB|WIFI)\]\s+)?--rsd\s+([\w:.%]+)\s+(\d+)/i)
      if (matchRsd) {
        const prefix = (matchRsd[1] || '').toUpperCase()
        let address = matchRsd[2]
        const port = matchRsd[3]
        
        // Logique de décision ultra-stricte à la ligne
        let isUSB = false
        if (prefix === 'USB') isUSB = true
        else if (prefix === 'WIFI') isUSB = false
        else {
          // Si pas de préfixe, l'USB n'est validé que si c'est localhost 
          // ou si le mot usbmux est présent sur CETTE ligne précise.
          isUSB = (address === '::1' || address === '127.0.0.1' || line.toLowerCase().includes('usbmux'))
        }

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

      if (line.includes('Disconnected from tunnel') || line.includes('Tunnel task failed')) {
        this.emit('disconnection')
      }
    })
  }

  stop() {
    this.runner.stop()
    this.isReady = false
    this.deviceInfo = {}
  }
}

module.exports = new TunneldDaemon()
