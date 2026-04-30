'use strict'

const BaseDriver = require('./BaseDriver')
const { PYTHON, checkServiceStatus } = require('../../python-resolver')
const ProcessRunner = require('../../utils/process-runner')
const { dbg } = require('../../logger')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

class Pmd3Driver extends BaseDriver {
  constructor() {
    super('pymobiledevice')
    this.runner = new ProcessRunner('pmd3-daemon', { priority: -5 })
    this.deviceInfo = {}
    this.networkOnlyMode = false
    
    // Chemin pour le cache RSD
    try {
      const { app } = require('electron')
      const storageDir = app ? app.getPath('userData') : path.join(__dirname, '..', '..', '..', '..', 'storage')
      this.statePath = path.join(storageDir, 'tunnel_state.json')
    } catch (e) {
      this.statePath = path.join(__dirname, '..', '..', '..', '..', 'storage', 'tunnel_state.json')
    }

    this.runner.on('stdout', (msg) => this._handleOutput(msg))
    this.runner.on('stderr', (msg) => this._handleOutput(msg))
  }

  async startTunnel() {
    if (this.runner.isRunning) return true

    // Vérification Bonjour/Avahi
    if (!checkServiceStatus()) {
      dbg(`[${this.id}] ⚠️ Service mDNS (Bonjour/Avahi) non détecté ou arrêté.`)
    }

    this.isStarting = true
    // 1. Montage automatique du DDI (nécessaire pour DVT/GPS)
    try {
      dbg(`[${this.id}] Montage automatique de l'image DDI...`)
      spawn(PYTHON, ['-m', 'pymobiledevice3', 'mounter', 'auto-mount'])
    } catch (e) {
      dbg(`[${this.id}] ⚠️ Erreur lors du montage DDI (peut-être déjà monté)`)
    }

    // 2. Lancement du tunnel RSD
    const args = ['-m', 'pymobiledevice3', 'lockdown', 'start-tunnel']
    
    this.runner.spawn(PYTHON, args)
    return true
  }

  async stopTunnel() {
    await super.stopTunnel()
    // Nettoyage du cache au stop
    if (fs.existsSync(this.statePath)) {
      try { fs.unlinkSync(this.statePath) } catch (e) {}
    }

    return new Promise((resolve) => {
      if (!this.runner.isRunning) return resolve(true)
      
      dbg(`[${this.id}] Demande de fermeture gracieuse du démon...`)
      this.runner.process.kill('SIGINT') // Envoie CTRL+C
      
      const timer = setTimeout(() => {
        if (this.runner.isRunning) {
          dbg(`[${this.id}] Le démon ne répond pas, arrêt forcé.`)
          this.runner.stop()
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
      dbg(`[${this.id}] Injection : ${lat}, ${lon} (RSD: [${address}]:${port})`)

      // IPv6 doit être entouré de guillemets/crochets si nécessaire, 
      // mais ici on passe les arguments individuellement à spawn qui gère l'escaping.
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

      // Parsing amélioré selon spécifications
      const matchAddr = line.match(/(?<=RSD Address: )([a-f0-9:]+)/i)
      const matchPort = line.match(/(?<=RSD Port: )(\d+)/i)

      if (matchAddr) this._pendingAddr = matchAddr[1]
      if (matchPort) this._pendingPort = matchPort[1]

      if (this._pendingAddr && this._pendingPort) {
        const address = this._pendingAddr
        const port = this._pendingPort
        
        this._pendingAddr = null
        this._pendingPort = null

        this.tunnelInfo = { 
          address, 
          port, 
          type: (address === '::1' || address === '127.0.0.1') ? 'USB' : 'WiFi',
          timestamp: new Date().toISOString()
        }

        // Persistance vers tunnel_state.json
        try {
          fs.writeFileSync(this.statePath, JSON.stringify(this.tunnelInfo, null, 2))
          dbg(`[${this.id}] 💾 RSD Cache mis à jour : ${this.statePath}`)
        } catch (e) {
          dbg(`[${this.id}] ⚠️ Erreur écriture cache RSD: ${e.message}`)
        }

        this.isActive = true
        this.isStarting = false
        this.emit('connection', this.tunnelInfo)
      }

      if (line.includes('Disconnected from tunnel') || line.includes('Tunnel task failed')) {
        this.isActive = false
        this.tunnelInfo = null
        this.emit('disconnection')
        if (fs.existsSync(this.statePath)) {
          try { fs.unlinkSync(this.statePath) } catch (e) {}
        }
      }
    })
  }

  async checkHealth() {
    if (!this.isActive || !this.tunnelInfo) return false

    return new Promise((resolve) => {
      const net = require('net')
      const socket = new net.Socket()
      let resolved = false

      socket.setTimeout(2000)

      socket.connect(this.tunnelInfo.port, this.tunnelInfo.address, () => {
        if (!resolved) {
          resolved = true
          socket.destroy()
          resolve(true)
        }
      })

      const onFail = () => {
        if (!resolved) {
          resolved = true
          socket.destroy()
          resolve(false)
        }
      }

      socket.on('error', onFail)
      socket.on('timeout', onFail)
    })
  }

  async listDevices() {
    return new Promise((resolve) => {
      const args = ['-m', 'pymobiledevice3', 'usbmux', 'list']
      const proc = spawn(PYTHON, args)
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (d) => stdout += d.toString())
      proc.stderr.on('data', (d) => stderr += d.toString())

      proc.on('close', (code) => {
        if (code !== 0) {
          dbg(`[${this.id}] Erreur listDevices (code ${code}): ${stderr}`)
          return resolve([])
        }
        try {
          // On nettoie l'éventuel texte avant/après le JSON si PMD3 envoie des logs sur stdout
          const jsonMatch = stdout.match(/\[[\s\S]*\]/)
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]))
          } else {
            resolve([])
          }
        } catch (e) {
          dbg(`[${this.id}] Erreur parsing listDevices: ${e.message}`)
          resolve([])
        }
      })
    })
  }
}

module.exports = Pmd3Driver
