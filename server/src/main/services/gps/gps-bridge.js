const http = require('http')
const { EventEmitter } = require('events')
const { dbg } = require('../../logger')

const TUNNEL_INFO_PORT = 28100

/**
 * GpsBridge - Orchestre l'injection de position via le driver actif (go-ios ou PMD3).
 */
class GpsBridge extends EventEmitter {
  constructor() {
    super()
    this.isReady = false
    this.pythonProcs = []
    dbg('[gps-bridge] Bridge multi-driver initialisé')
  }

  start() {
    this.isReady = true
    dbg('[gps-bridge] ✅ Bridge prêt')
    this.emit('ready')
  }

  /**
   * Récupère le driver actif et les infos de connexion depuis l'orchestrateur.
   */
  _getActiveContext() {
    const orchestrator = require('../../tunneld-manager')
    return {
      driver: orchestrator.getActiveDriver(),
      address: orchestrator.getRsdAddress(),
      port: orchestrator.getRsdPort(),
      udid: orchestrator.getDeviceInfo()?.id || orchestrator.activeConnection?.id
    }
  }

  async sendCommand(action, _host, _port, payload = {}) {
    const ctx = this._getActiveContext()
    
    if (!ctx.driver || !ctx.address) {
      if (action === 'heartbeat') return { success: false }
      dbg(`[gps-bridge] ❌ Commande ${action} annulée : Pas de tunnel actif`)
      return { success: false, error: 'Pas de tunnel actif' }
    }

    if (action === 'set_location') {
      return this._setLocation(ctx, payload.lat, payload.lon)
    }
    if (action === 'clear_location') {
      return this._clearLocation(ctx)
    }
    if (action === 'heartbeat') {
      return { success: true } // On a un tunnel actif, donc heartbeat OK
    }
    return { success: false, error: `Action inconnue : ${action}` }
  }

  async _setLocation(ctx, lat, lon) {
    dbg(`[gps-bridge] Injection (${ctx.driver}) : ${lat}, ${lon}`)

    if (ctx.driver === 'go-ios') {
      return this._setLocationGoIos(ctx, lat, lon)
    } else {
      return this._setLocationPmd3(ctx, lat, lon)
    }
  }

  /**
   * Injection via l'API REST locale de go-ios (très stable)
   */
  async _setLocationGoIos(ctx, lat, lon) {
    return new Promise((resolve) => {
      const data = JSON.stringify({ lat: parseFloat(lat), lon: parseFloat(lon) })
      const udid = ctx.udid || 'any'
      
      const req = http.request({
        hostname: '127.0.0.1',
        port: TUNNEL_INFO_PORT,
        path: `/device/${udid}/location`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        },
        timeout: 2000
      }, (res) => {
        if (res.statusCode === 200) {
          resolve({ success: true })
        } else {
          dbg(`[gps-bridge] ❌ Erreur API go-ios : Status ${res.statusCode}`)
          // Fallback vers Python si l'API REST échoue ? 
          // Non, on reste sur le driver choisi par l'utilisateur.
          resolve({ success: false, error: `HTTP ${res.statusCode}` })
        }
      })

      req.on('error', (e) => {
        dbg(`[gps-bridge] ❌ Erreur injection go-ios REST : ${e.message}`)
        resolve({ success: false, error: e.message })
      })

      req.write(data)
      req.end()
    })
  }

  /**
   * Injection via pymobiledevice3 (DVT)
   */
  async _setLocationPmd3(ctx, lat, lon) {
    this.stop() // S'assurer qu'un seul processus d'injection tourne à la fois
    
    // Premier essai avec l'adresse fournie
    const result = await this._execPmd3Set(ctx.address, ctx.port, lat, lon)
    
    // Si échec (notamment Timeout), et que c'était une IPv6 complexe, on tente via le Loopback
    if (!result.success && ctx.address.includes(':') && ctx.address !== '::1') {
      dbg(`[gps-bridge] 🔄 Tentative de repli (fallback) sur [::1]...`)
      return await this._execPmd3Set('::1', ctx.port, lat, lon)
    }

    return result
  }

  async _execPmd3Set(address, port, lat, lon) {
    return new Promise((resolve) => {
      const { PYTHON } = require('../../python-resolver')
      const { spawn } = require('child_process')
      const path = require('path')
      
      // IMPORTANT: En ligne de commande --rsd, pymobiledevice3 attend l'adresse brute
      // SANS les crochets [ ], contrairement aux URLs.
      const rsdAddress = address
      
      const args = [
        '-m', 'pymobiledevice3', 
        'developer', 'dvt', 'simulate-location', 'set',
        '--rsd', rsdAddress, String(port),
        '--',
        String(lat), String(lon)
      ]

      dbg(`[gps-bridge] Exécution : ${PYTHON} ${args.join(' ')}`)

      const newProc = spawn(PYTHON, args, { shell: false, cwd: path.dirname(PYTHON) })
      this.pythonProcs.push(newProc)

      let resolved = false
      let lastStderr = ''
      const done = (success, error) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        resolve({ success, error })
      }

      newProc.stdout.on('data', (d) => { 
        const msg = d.toString()
        if (msg.toLowerCase().includes('enter') || msg.toLowerCase().includes('success')) done(true) 
      })
      newProc.stderr.on('data', (d) => { 
        lastStderr += d.toString()
        dbg(`[gps-bridge] STDERR: ${d.toString().trim()}`)
      })
      
      const timer = setTimeout(() => done(false, `Timeout PMD3 ${lastStderr ? ': ' + lastStderr : ''}`), 10000)

      newProc.on('close', (code) => {
        this.pythonProcs = this.pythonProcs.filter(p => p !== newProc)
        if (code === 0) done(true)
        else done(false, `Code ${code}${lastStderr ? ' - ' + lastStderr : ''}`)
      })
    })
  }

  async playGpx(gpxPath) {
    const ctx = this._getActiveContext()
    dbg(`[gps-bridge] Lecture GPX (${ctx.driver}) : ${gpxPath}`)

    this.stop() // Arrête les simulations en cours

    return new Promise((resolve) => {
      const { PYTHON } = require('../../python-resolver')
      const { spawn } = require('child_process')
      const path = require('path')

      // Pour l'instant on garde PMD3 pour le GPX car go-ios REST ne supporte peut-être pas encore le play via HTTP de façon standard
      const rsdAddress = ctx.address.includes(':') ? `[${ctx.address}]` : ctx.address
      const args = [
        '-m', 'pymobiledevice3', 
        'developer', 'dvt', 'simulate-location', 'play',
        '--rsd', rsdAddress, String(ctx.port),
        gpxPath
      ]

      dbg(`[gps-bridge] Exécution GPX : ${PYTHON} ${args.join(' ')}`)

      const proc = spawn(PYTHON, args, { shell: false, cwd: path.dirname(PYTHON) })
      this.pythonProcs.push(proc)

      proc.on('close', () => {
        this.pythonProcs = this.pythonProcs.filter(p => p !== proc)
      })

      resolve({ success: true })
    })
  }

  async _clearLocation(ctx) {
    if (ctx.driver === 'go-ios') {
      // DELETE via REST
      const udid = ctx.udid || 'any'
      const req = http.request({
        hostname: '127.0.0.1', port: TUNNEL_INFO_PORT, path: `/device/${udid}/location`, method: 'DELETE'
      })
      req.end()
    } else {
      const { PYTHON } = require('../../python-resolver')
      const { spawn } = require('child_process')
      const rsdAddress = ctx.address.includes(':') ? `[${ctx.address}]` : ctx.address
      spawn(PYTHON, [
        '-m', 'pymobiledevice3', 'developer', 'dvt', 'simulate-location', 'clear',
        '--rsd', rsdAddress, String(ctx.port)
      ])
    }
    return { success: true }
  }

  stop() {
    this.pythonProcs.forEach(p => { try { p.kill('SIGKILL') } catch(e) {} })
    this.pythonProcs = []
  }
}

module.exports = new GpsBridge()

