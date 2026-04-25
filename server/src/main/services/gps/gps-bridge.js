'use strict'

const http = require('http')
const { EventEmitter } = require('events')
const { dbg } = require('../../logger')

const TUNNEL_INFO_PORT = 28100

/**
 * GpsBridge (go-ios) - Envoie les commandes GPS via l'API REST HTTP de go-ios.
 *
 * Architecture simplifiée :
 *   - Plus de bridge Python, plus de socket TCP, plus de subprocess dvt
 *   - Appel HTTP direct : PUT http://localhost:28100/device/:udid/location
 *   - go-ios gère la connexion au service DVT en interne
 *   - Stable car go-ios maintient la session DVT de façon native
 */
class GpsBridge extends EventEmitter {
  constructor() {
    super()
    this.isReady = false
    this._udid = null
    dbg('[gps-bridge] Bridge go-ios initialisé')
  }

  /**
   * Démarre le bridge (no-op pour go-ios, le tunnel est géré par tunneld-service).
   * Maintenu pour la compatibilité avec l'API appelante.
   */
  start() {
    this.isReady = true
    dbg('[gps-bridge] ✅ Bridge go-ios prêt (API REST HTTP)')
    this.emit('ready')
  }

  /**
   * Récupère le UDID de l'appareil connecté depuis l'API go-ios.
   */
  async _getUdid() {
    if (this._udid) return this._udid

    return new Promise((resolve) => {
      const http = require('http')
      const req = http.get(`http://127.0.0.1:${TUNNEL_INFO_PORT}/tunnels`, { timeout: 2000 }, (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          try {
            const tunnels = JSON.parse(body)
            if (Array.isArray(tunnels) && tunnels.length > 0 && tunnels[0].udid) {
              this._udid = tunnels[0].udid
              resolve(this._udid)
            } else {
              resolve(null)
            }
          } catch (e) { resolve(null) }
        })
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
    })
  }

  async sendCommand(action, _rsdHost, _rsdPort, payload = {}) {
    if (action === 'set_location') {
      return this._setLocation(payload.lat, payload.lon)
    }
    if (action === 'clear_location') {
      return this._clearLocation()
    }
    if (action === 'heartbeat') {
      const udid = await this._getUdid()
      return { success: !!udid }
    }
    return { success: false, error: `Action inconnue : ${action}` }
  }

  async _setLocation(lat, lon) {
    dbg(`[gps-bridge] Tentative d'injection : ${lat}, ${lon}`)
    const tunnelInfo = await this._getTunnelInfo()
    if (!tunnelInfo) {
      dbg('[gps-bridge] ❌ Injection annulée : Tunnel Go-iOS non détecté via API')
      return { success: false, error: 'Tunnel Go-iOS non détecté' }
    }

    const { address, rsdPort } = tunnelInfo
    
    if (!this.pythonProcs) this.pythonProcs = []
    
    dbg(`[gps-bridge] Injection Cumulative : Python PMD3 sur Tunnel Go (${address}:${rsdPort})`)
    
    return new Promise((resolve) => {
      const { PYTHON } = require('../../python-resolver')
      const { spawn } = require('child_process')
      const path = require('path')
      
      const args = [
        '-m', 'pymobiledevice3', 
        'developer', 'dvt', 'simulate-location', 'set',
        '--rsd', address, String(rsdPort),
        '--',
        String(lat), String(lon)
      ]

      const newProc = spawn(PYTHON, args, {
        shell: true,
        cwd: path.dirname(PYTHON)
      })

      this.pythonProcs.push(newProc)

      let resolved = false

      newProc.stdout.on('data', (data) => {
        const msg = data.toString()
        if (msg.includes('Press ENTER to exit')) {
          if (!resolved) {
            resolved = true
            dbg(`[gps-bridge] ✅ Position active (Processus #${this.pythonProcs.length})`)
            resolve({ success: true })
          }
        }
      })

      newProc.stderr.on('data', (data) => { 
        const msg = data.toString()
        if (msg.includes('Error')) dbg(`[python-pmd3-err] ${msg.trim()}`)
      })

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          dbg('[gps-bridge] ⚠️ Timeout sur l\'injection')
          resolve({ success: false, error: 'Timeout' })
        }
      }, 10000)

      newProc.on('close', (code) => {
        if (timer) clearTimeout(timer)
        // Retirer de la liste si le processus s'arrête de lui-même
        this.pythonProcs = this.pythonProcs.filter(p => p !== newProc)
      })
    })
  }

  async _getTunnelInfo() {
    return new Promise((resolve) => {
      const http = require('http')
      const req = http.get(`http://127.0.0.1:${TUNNEL_INFO_PORT}/tunnels`, { timeout: 1500 }, (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          try {
            const tunnels = JSON.parse(body)
            if (Array.isArray(tunnels) && tunnels.length > 0) {
              const t = tunnels[0]
              resolve({ udid: t.udid, address: t.address || t.tunnelAddress, rsdPort: t.rsdPort || t.tunnelPort })
            } else {
              // dbg('[gps-bridge] API /tunnels retournée vide')
              resolve(null)
            }
          } catch (e) { 
            dbg(`[gps-bridge] Erreur parsing /tunnels : ${e.message}`)
            resolve(null) 
          }
        })
      })
      req.on('error', (e) => {
        // dbg(`[gps-bridge] Erreur HTTP /tunnels : ${e.message}`)
        resolve(null)
      })
      req.end()
    })
  }

  async _mountImage(udid) {
    dbg('[gps-bridge] Tentative de montage auto de l\'image développeur...')
    return new Promise((resolve) => {
      const { GOIOS } = require('../../goios-resolver')
      const { spawn } = require('child_process')
      const path = require('path')
      const proc = spawn(GOIOS, ['image', 'auto', `--udid=${udid}`], { cwd: path.dirname(GOIOS) })
      proc.on('close', () => resolve())
    })
  }

  async _clearLocation() {
    const tunnelInfo = await this._getTunnelInfo()
    if (!tunnelInfo) return { success: true }

    const { PYTHON } = require('../../python-resolver')
    const { spawn } = require('child_process')

    spawn(PYTHON, [
        '-m', 'pymobiledevice3', 
        'developer', 'dvt', 'simulate-location', 'clear',
        '--rsd', tunnelInfo.address, String(tunnelInfo.rsdPort)
    ])
    return { success: true }
  }

  stop() {
    if (this.pythonProcs) {
      this.pythonProcs.forEach(p => p.kill())
      this.pythonProcs = []
    }
    this._udid = null
    this.isReady = false
  }
}

module.exports = new GpsBridge()
