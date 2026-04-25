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
      const req = http.get(`http://127.0.0.1:${TUNNEL_INFO_PORT}/`, { timeout: 2000 }, (res) => {
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

  /**
   * Envoie une commande via l'API REST go-ios.
   *
   * @param {string} action  'set_location' | 'clear_location' | 'heartbeat'
   * @param {string} _rsdHost  ignoré (go-ios gère le tunnel en interne)
   * @param {string} _rsdPort  ignoré
   * @param {object} payload  { lat, lon } pour set_location
   */
  async sendCommand(action, _rsdHost, _rsdPort, payload = {}) {
    if (action === 'set_location') {
      dbg(`[CMD] Simulation : ${payload.lat}, ${payload.lon}`)
      return this._setLocation(payload.lat, payload.lon)
    }

    if (action === 'clear_location') {
      return this._clearLocation()
    }

    if (action === 'heartbeat') {
      return this._heartbeat()
    }

    return { success: false, error: `Action inconnue : ${action}` }
  }

  async _setLocation(lat, lon) {
    const udid = await this._getUdid()
    if (!udid) {
      return { success: false, error: 'Aucun appareil connecté (go-ios tunnel non actif)' }
    }

    return new Promise((resolve) => {
      const body = JSON.stringify({ lat: parseFloat(lat), lon: parseFloat(lon) })
      const options = {
        hostname: '127.0.0.1',
        port: TUNNEL_INFO_PORT,
        path: `/device/${udid}/location`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 8000
      }

      const req = http.request(options, (res) => {
        let resBody = ''
        res.on('data', (c) => { resBody += c })
        res.on('end', () => {
          if (res.statusCode === 200) {
            dbg(`[OK] go-ios a appliqué la position`)
            resolve({ success: true })
          } else {
            dbg(`[ERR] go-ios a retourné HTTP ${res.statusCode} : ${resBody}`)
            // Invalider le UDID si erreur (appareil peut avoir changé)
            this._udid = null
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${resBody}` })
          }
        })
      })

      req.on('error', (err) => {
        dbg(`[ERR] go-ios API error: ${err.message}`)
        resolve({ success: false, error: err.message })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ success: false, error: 'Timeout API go-ios (8s)' })
      })

      req.write(body)
      req.end()
    })
  }

  async _clearLocation() {
    const udid = await this._getUdid()
    if (!udid) return { success: true } // Pas d'appareil, rien à faire

    return new Promise((resolve) => {
      const options = {
        hostname: '127.0.0.1',
        port: TUNNEL_INFO_PORT,
        path: `/device/${udid}/location`,
        method: 'DELETE',
        timeout: 5000
      }

      const req = http.request(options, (res) => {
        res.resume() // Vider le body
        res.on('end', () => {
          dbg('[OK] Position réinitialisée')
          resolve({ success: true })
        })
      })
      req.on('error', () => resolve({ success: true }))
      req.on('timeout', () => { req.destroy(); resolve({ success: true }) })
      req.end()
    })
  }

  async _heartbeat() {
    const udid = await this._getUdid()
    return { success: true, status: udid ? 'alive' : 'idle' }
  }

  stop() {
    this._udid = null
    this.isReady = false
  }
}

module.exports = new GpsBridge()
