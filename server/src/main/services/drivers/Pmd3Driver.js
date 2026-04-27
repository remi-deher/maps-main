'use strict'

const BaseDriver = require('./BaseDriver')
const { PYTHON } = require('../../python-resolver')
const ProcessRunner = require('../../utils/process-runner')
const { dbg } = require('../../logger')
const { spawn } = require('child_process')
const Encoder = require('../../utils/encoder')

class Pmd3Driver extends BaseDriver {
  constructor() {
    super('pymobiledevice')
    this.runner = new ProcessRunner('pmd3-daemon', { priority: -5 })
    this.deviceInfo = {}
    
    this.runner.on('stdout', (msg) => this._handleOutput(msg))
    this.runner.on('stderr', (msg) => this._handleOutput(msg))
  }

  async startTunnel() {
    if (this.runner.isRunning) return true
    this.isStarting = true
    dbg(`[${this.id}] Lancement du démon tunneld...`)
    
    const settings = require('../settings-manager')
    const args = ['-m', 'pymobiledevice3', 'remote', 'tunneld']
    
    // Priorité PMD3 : si go-ios est préféré pour l'USB, on ignore l'USB ici
    if (settings.get('usbDriver') === 'go-ios') {
      args.push('--no-usbmux') 
    }
    
    this.runner.spawn(PYTHON, args)
    return true
  }

  async stopTunnel() {
    await super.stopTunnel()
    return new Promise((resolve) => {
      if (!this.runner.isRunning) return resolve(true)
      
      dbg(`[${this.id}] Demande de fermeture gracieuse du démon...`)
      this.runner.process.kill('SIGINT') // Envoie CTRL+C
      
      // On laisse un délai de grâce pour le nettoyage (Keep-Alive, TUN close)
      const timer = setTimeout(() => {
        if (this.runner.isRunning) {
          dbg(`[${this.id}] Le démon ne répond pas, arrêt forcé.`)
          this.runner.stop() // SIGKILL final
        }
        resolve(true)
      }, 3000)

      const check = setInterval(() => {
        if (!this.runner.isRunning) {
          clearInterval(check)
          clearTimeout(timer)
          dbg(`[${this.id}] Démon PMD3 arrêté proprement.`)
          resolve(true)
        }
      }, 200)
    })
  }

  async setLocation(lat, lon, name) {
    if (!this.tunnelInfo) return { success: false, error: 'Tunnel PMD3 non prêt' }

    return new Promise((resolve) => {
      const { address, port } = this.tunnelInfo
      dbg(`[${this.id}] Injection : ${lat}, ${lon} (RSD: ${address}:${port})`)

      const args = [
        '-m', 'pymobiledevice3', 
        'developer', 'dvt', 'simulate-location', 'set',
        '--rsd', address, String(port),
        '--',
        String(lat), String(lon)
      ]

      const proc = spawn(PYTHON, args)
      let resolved = false
      let lastStderr = ''

      const done = (success, error) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        resolve({ success, error })
      }

      proc.stdout.on('data', (d) => {
        const msg = d.toString()
        if (msg.toLowerCase().includes('enter') || msg.toLowerCase().includes('success')) done(true)
      })

      proc.stderr.on('data', (d) => {
        lastStderr += d.toString()
        dbg(`[${this.id}] STDERR: ${d.toString().trim()}`)
      })

      const timer = setTimeout(() => done(false, `Timeout PMD3 ${lastStderr ? ': ' + lastStderr : ''}`), 10000)

      proc.on('close', (code) => {
        if (code === 0) done(true)
        else done(false, `Code ${code} - ${lastStderr}`)
      })
    })
  }

  async clearLocation() {
    if (!this.tunnelInfo) return { success: false }
    // Implémentation via 'stop'
    const { address, port } = this.tunnelInfo
    const args = ['-m', 'pymobiledevice3', 'developer', 'dvt', 'simulate-location', 'clear', '--rsd', address, String(port)]
    const proc = spawn(PYTHON, args)
    return new Promise(res => proc.on('close', code => res({ success: code === 0 })))
  }

  _handleOutput(text) {
    if (!text) return
    const lines = text.split(/\r?\n/)

    lines.forEach(line => {
      if (!line.trim()) return

      if (line.includes('Uvicorn running on')) {
        this.isReady = true
        this.isStarting = false
      }

      // Capture RSD et Type
      const matchRsd = line.match(/(?:\[(USB|WIFI)\]\s+)?--rsd\s+([\w:.%]+)\s+(\d+)/i)
      if (matchRsd) {
        const prefix = (matchRsd[1] || '').toUpperCase()
        let address = matchRsd[2]
        const port = matchRsd[3]
        
        let isUSB = false
        if (prefix === 'USB') isUSB = true
        else if (prefix === 'WIFI') isUSB = false
        else isUSB = (address === '::1' || address === '127.0.0.1' || line.toLowerCase().includes('usbmux'))

        address = address.replace(/%[0-9]+$/, '') // Clean scope ID

        this.tunnelInfo = { address, port, type: isUSB ? 'USB' : 'WiFi' }
        this.isActive = true
        this.emit('connection', this.tunnelInfo)
      }

      if (line.includes('Disconnected from tunnel') || line.includes('Tunnel task failed')) {
        this.isActive = false
        this.tunnelInfo = null
        this.emit('disconnection')
      }
    })
  }
}

module.exports = Pmd3Driver
