'use strict'

const { EventEmitter } = require('events')
const { dbg } = require('../../logger')
const nativeBonjour = require('../../tunneld/native-bonjour')

/**
 * BonjourConnector - Gère la découverte WiFi via Bonjour (dns-sd)
 * Priorité 2 - Préférence IPv6
 */
class BonjourConnector extends EventEmitter {
  constructor() {
    super()
    this.activeConnection = null
    this.scanInterval = null
    this._isScanning = false
    this._isQuitting = false
  }

  start() {
    if (this._isScanning || this._isQuitting) return
    this._isScanning = true
    dbg('[bonjour-connector] Lancement de la decouverte WiFi (Bonjour)...')
    this._doScan()
  }

  async _doScan() {
    while (this._isScanning && !this._isQuitting) {
      try {
        const instances = await nativeBonjour.scan(5000)
        if (instances.length > 0 && !this.activeConnection) {
          // On prend la première instance (souvent l'iPhone cible)
          // native-bonjour favorise déjà l'IPv6 si présent dans le nom mac@ipv6
          const target = await nativeBonjour.resolve(instances[0])
          
          if (target && !this.activeConnection) {
            dbg(`[bonjour-connector] WiFi detecte (Bonjour) : ${target.address}:${target.port}`)
            this.activeConnection = { address: target.address, port: target.port, type: 'WiFi' }
            this.emit('connection', this.activeConnection)
            break // On arrête le scan actif une fois connecté
          }
        }
      } catch (e) {
        dbg(`[bonjour-connector] Erreur scan: ${e.message}`)
      }
      if (!this.activeConnection) await new Promise(resolve => setTimeout(resolve, 2000))
    }
    this._isScanning = false
  }

  stop() {
    this._isScanning = false
    this.activeConnection = null
    nativeBonjour.stop()
  }

  destroy() {
    this._isQuitting = true
    this.stop()
  }
}

module.exports = BonjourConnector
