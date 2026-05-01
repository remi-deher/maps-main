'use strict'

const BaseDriver = require('./BaseDriver')
const bin = require('../../platform/BinaryManager')
const { dbg } = require('../../logger')
const { spawn } = require('child_process')

/**
 * GoIosDriver (V2) - Version unifiée et agnostique.
 */
class GoIosDriver extends BaseDriver {
  constructor() {
    super('go-ios')
    this.process = null
  }

  async startTunnel() {
    if (this.process) return true
    this.isStarting = true
    
    const { exe, fullArgs } = bin.getSpawnArgs('go-ios', ['tunnel', 'start'])
    dbg(`[${this.id}] 🚀 Lancement : ${exe} ${fullArgs.join(' ')}`)
    
    this.process = spawn(exe, fullArgs)
    this.process.on('error', (e) => {
      dbg(`[${this.id}] ❌ Spawn error: ${e.message}`)
      this.isStarting = false
    })

    // Sécurité : déblocage automatique si rien ne se passe
    setTimeout(() => {
      if (this.isStarting) {
        dbg(`[${this.id}] ⚠️ Timeout initialisation tunnel, réinitialisation...`)
        this.isStarting = false
      }
    }, 15000)

    this.process.stdout.on('data', (data) => {
      const text = data.toString()
      const match = text.match(/RSD address: ([\w:.%]+):(\d+)/)
      if (match) {
        this.tunnelInfo = { address: match[1], port: match[2], type: 'WIFI (go-ios)' }
        this.isActive = true; this.isStarting = false;
        this.emit('connection', this.tunnelInfo)
      }
      this.emit('stdout', text)
    })

    this.process.stderr.on('data', (data) => {
      this.emit('stderr', data.toString())
    })

    this.process.on('close', () => {
      this.process = null; this.isActive = false; this.tunnelInfo = null;
      this.isStarting = false
      this.emit('disconnection')
    })

    return true
  }

  async stopTunnel() {
    await super.stopTunnel()
    return new Promise((resolve) => {
      if (!this.process) return resolve(true)
      this.process.kill('SIGINT') 
      const timer = setTimeout(() => {
        if (this.process) this.process.kill('SIGKILL')
        resolve(true)
      }, 3000)
      this.process.on('close', () => { clearTimeout(timer); resolve(true) })
    })
  }

  async setLocation(lat, lon) {
    if (!this.isActive || !this.tunnelInfo) return { success: false, error: 'Tunnel non prêt' }
    const { address, port } = this.tunnelInfo
    const { exe, fullArgs } = bin.getSpawnArgs('go-ios', ['setlocation', '--rsd', `${address}:${port}`, String(lat), String(lon)])
    return new Promise((resolve) => {
      const proc = spawn(exe, fullArgs)
      proc.on('error', (e) => resolve({ success: false, error: e.message }))
      proc.on('close', (code) => resolve({ success: code === 0 }))
    })
  }

  async clearLocation() {
    if (!this.isActive || !this.tunnelInfo) return { success: false }
    const { address, port } = this.tunnelInfo
    const { exe, fullArgs } = bin.getSpawnArgs('go-ios', ['setlocation', '--rsd', `${address}:${port}`, 'reset'])
    const proc = spawn(exe, fullArgs)
    proc.on('error', (e) => dbg(`[go-ios] Clear error: ${e.message}`))
    return new Promise(res => proc.on('close', code => res({ success: code === 0 })))
  }

  /**
   * Vérifie si le tunnel RSD est toujours accessible
   */
  async checkHealth() {
    if (!this.isActive || !this.tunnelInfo) return true

    const net = require('net')
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(3000)

      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })

      socket.on('error', () => {
        socket.destroy()
        resolve(false)
      })

      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })

      socket.connect(this.tunnelInfo.port, this.tunnelInfo.address)
    })
  }
}

module.exports = GoIosDriver
