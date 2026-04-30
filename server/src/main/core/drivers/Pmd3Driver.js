'use strict'

const BaseDriver = require('./BaseDriver')
const bin = require('../../platform/BinaryManager')
const { getStoragePath } = require('../../platform/PathResolver')
const ProcessRunner = require('../../utils/process-runner')
const { dbg } = require('../../logger')
const { spawn } = require('child_process')
const fs = require('fs')

/**
 * Pmd3Driver (V2) - Version unifiée et agnostique.
 * Utilise BinaryManager pour résoudre les commandes selon l'OS.
 */
class Pmd3Driver extends BaseDriver {
  constructor() {
    super('pymobiledevice')
    this.runner = new ProcessRunner('pmd3-daemon', { priority: -5 })
    this.deviceInfo = {}
    this.networkOnlyMode = false
    
    // Chemin pour le cache RSD résolu via PathResolver
    this.statePath = getStoragePath('tunnel_state.json')

    this.runner.on('stdout', (msg) => this._handleOutput(msg))
    this.runner.on('stderr', (msg) => this._handleOutput(msg))
  }

  async startTunnel() {
    if (this.runner.isRunning) return true

    // Vérification mDNS (on délègue à un utilitaire si besoin, ici on garde simple)
    this.isStarting = true
    
    // 1. Montage automatique du DDI
    try {
      dbg(`[${this.id}] Montage automatique de l'image DDI...`)
      const { exe, fullArgs } = bin.getSpawnArgs('pmd3', ['mounter', 'auto-mount'])
      spawn(exe, fullArgs).on('error', (e) => dbg(`[${this.id}] ⚠️ Spawn Mount error: ${e.message}`))
    } catch (e) {
      dbg(`[${this.id}] ⚠️ Erreur lors du montage DDI (peut-être déjà monté)`)
    }

    // 2. Lancement du tunnel RSD
    dbg(`[${this.id}] Lancement du tunnel RSD (Mode Unifié)...`)
    const { exe, fullArgs } = bin.getSpawnArgs('pmd3', ['lockdown', 'start-tunnel'])
    this.runner.spawn(exe, fullArgs)
    
    return true
  }

  async stopTunnel() {
    await super.stopTunnel()
    if (fs.existsSync(this.statePath)) {
      try { fs.unlinkSync(this.statePath) } catch (e) {}
    }

    return new Promise((resolve) => {
      if (!this.runner.isRunning) return resolve(true)
      this.runner.process.kill('SIGINT')
      
      const timer = setTimeout(() => {
        if (this.runner.isRunning) this.runner.stop()
        resolve(true)
      }, 3000)

      const check = setInterval(() => {
        if (!this.runner.isRunning) {
          clearInterval(check)
          clearTimeout(timer)
          resolve(true)
        }
      }, 200)
    })
  }

  async setLocation(lat, lon, name) {
    if (!this.tunnelInfo) return { success: false, error: 'Tunnel PMD3 non prêt' }

    return new Promise((resolve) => {
      const { address, port } = this.tunnelInfo
      dbg(`[${this.id}] Injection : ${lat}, ${lon} (RSD: [${address}]:${port})`)

      const { exe, fullArgs } = bin.getSpawnArgs('pmd3', [
        'developer', 'dvt', 'simulate-location', 'set',
        '--rsd', address, String(port),
        '--',
        String(lat), String(lon)
      ])

      const proc = spawn(exe, fullArgs)
      proc.on('error', (e) => done(false, `Spawn error: ${e.message}`))
      let resolved = false
      let lastStderr = ''

      const done = (success, error) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        resolve({ success, error })
      }

      proc.stdout.on('data', (d) => {
        if (d.toString().toLowerCase().includes('success')) done(true)
      })

      proc.stderr.on('data', (d) => {
        lastStderr += d.toString()
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
    const { address, port } = this.tunnelInfo
    const { exe, fullArgs } = bin.getSpawnArgs('pmd3', ['developer', 'dvt', 'simulate-location', 'clear', '--rsd', address, String(port)])
    const proc = spawn(exe, fullArgs)
    return new Promise(res => proc.on('close', code => res({ success: code === 0 })))
  }

  _handleOutput(text) {
    if (!text) return
    const lines = text.split(/\r?\n/)
    lines.forEach(line => {
      const matchAddr = line.match(/(?<=RSD Address: )([a-f0-9:]+)/i)
      const matchPort = line.match(/(?<=RSD Port: )(\d+)/i)
      if (matchAddr) this._pendingAddr = matchAddr[1]
      if (matchPort) this._pendingPort = matchPort[1]

      if (this._pendingAddr && this._pendingPort) {
        this.tunnelInfo = { 
          address: this._pendingAddr, 
          port: this._pendingPort, 
          type: (this._pendingAddr === '::1' || this._pendingAddr === '127.0.0.1') ? 'USB' : 'WiFi',
          timestamp: new Date().toISOString()
        }
        this._pendingAddr = null; this._pendingPort = null;
        try { fs.writeFileSync(this.statePath, JSON.stringify(this.tunnelInfo, null, 2)) } catch (e) {}
        this.isActive = true
        this.isStarting = false
        this.emit('connection', this.tunnelInfo)
      }
      if (line.includes('Disconnected from tunnel') || line.includes('Tunnel task failed')) {
        this.isActive = false
        this.tunnelInfo = null
        this.emit('disconnection')
      }
    })
  }

  async listDevices() {
    return new Promise((resolve) => {
      const { exe, fullArgs } = bin.getSpawnArgs('pmd3', ['usbmux', 'list'])
      const proc = spawn(exe, fullArgs)
      let stdout = ''
      proc.stdout.on('data', (d) => stdout += d.toString())
      proc.on('close', (code) => {
        if (code !== 0) return resolve([])
        try {
          const jsonMatch = stdout.match(/\[[\s\S]*\]/)
          resolve(jsonMatch ? JSON.parse(jsonMatch[0]) : [])
        } catch (e) { resolve([]) }
      })
    })
  }
}

module.exports = Pmd3Driver
