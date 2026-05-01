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
    this.runner.on('exit', () => {
      this.isStarting = false
      this.isActive = false
      this.tunnelInfo = null
    })
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

    // 2. Lancement du tunnel RSD (Mode Daemon/Tunneld)
    dbg(`[${this.id}] Lancement du daemon tunneld (Mode Reconnect)...`)
    const { exe, fullArgs } = bin.getSpawnArgs('pmd3', ['remote', 'tunneld'])
    this.runner.spawn(exe, fullArgs)
    
    // Sécurité : déblocage si rien ne se passe
    setTimeout(() => {
      if (this.isStarting) this.isStarting = false
    }, 15000)
    
    return true
  }

  async stopTunnel() {
    await super.stopTunnel()
    if (fs.existsSync(this.statePath)) {
      try { fs.unlinkSync(this.statePath) } catch (e) {}
    }

    return new Promise((resolve) => {
      if (!this.runner.isRunning) return resolve(true)
      this.runner.stop().then(() => resolve(true))
    })
  }

  async setLocation(lat, lon, name) {
    if (!this.tunnelInfo) return { success: false, error: 'Tunnel PMD3 non prêt' }

    return new Promise((resolve) => {
      const { address, port } = this.tunnelInfo
      dbg(`[${this.id}] Injection : ${lat}, ${lon} (RSD: [${address}]:${port})`)

      // On utilise les crochets pour l'IPv6 si nécessaire
      const rsdAddr = address.includes(':') ? `[${address}]` : address

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
      // Nouveau format : Created tunnel --rsd fd91:cdc1:ca4d::1 51139
      const matchTunneld = line.match(/Created tunnel --rsd\s+([a-f0-9:]+)\s+(\d+)/i)
      
      // Ancien format (fallback)
      const matchAddr = line.match(/(?<=RSD Address: )([a-f0-9:]+)/i)
      const matchPort = line.match(/(?<=RSD Port: )(\d+)/i)

      let addr = null, port = null

      if (matchTunneld) {
        addr = matchTunneld[1]
        port = matchTunneld[2]
      } else {
        if (matchAddr) this._pendingAddr = matchAddr[1]
        if (matchPort) this._pendingPort = matchPort[1]
        if (this._pendingAddr && this._pendingPort) {
          addr = this._pendingAddr
          port = this._pendingPort
          this._pendingAddr = null; this._pendingPort = null;
        }
      }

      if (addr && port) {
        dbg(`[pmd3] 🎯 Tunnel détecté : [${addr}]:${port}`)
        this.tunnelInfo = { 
          address: addr, 
          port: port, 
          type: (addr === '::1' || addr === '127.0.0.1' || addr.startsWith('fe80')) ? 'USB' : 'WiFi',
          timestamp: new Date().toISOString()
        }
        try { fs.writeFileSync(this.statePath, JSON.stringify(this.tunnelInfo, null, 2)) } catch (e) {}
        this.isActive = true
        this.isStarting = false
        this.emit('connection', this.tunnelInfo)
      }

      if (line.includes('Disconnected') || line.includes('Tunnel task failed') || line.includes('Stopping tunnel')) {
        dbg(`[pmd3] 🔌 Déconnexion détectée`)
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

  /**
   * Vérifie si le tunnel RSD est toujours accessible par une tentative de connexion socket
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

      socket.on('error', (e) => {
        dbg(`[pmd3] 🚨 Échec Health Check (Connect Error): ${e.message}`)
        socket.destroy()
        resolve(false)
      })

      socket.on('timeout', () => {
        dbg(`[pmd3] 🚨 Échec Health Check (Timeout)`)
        socket.destroy()
        resolve(false)
      })

      // Node.js connect gère l'IPv6 (sans crochets)
      socket.connect(this.tunnelInfo.port, this.tunnelInfo.address)
    })
  }
}

module.exports = Pmd3Driver
