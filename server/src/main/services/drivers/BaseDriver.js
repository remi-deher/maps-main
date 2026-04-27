'use strict'

const { EventEmitter } = require('events')
const { dbg } = require('../../logger')

/**
 * BaseDriver - Classe abstraite pour tous les drivers de connexion iPhone (PMD3, go-ios, etc.)
 */
class BaseDriver extends EventEmitter {
  constructor(id) {
    super()
    this.id = id
    this.isActive = false
    this.isStarting = false
    this.tunnelInfo = null // { address, port, type }
  }

  /**
   * Démarre le tunnel de communication
   * @returns {Promise<boolean>}
   */
  async startTunnel() {
    throw new Error(`Method startTunnel() not implemented for driver ${this.id}`)
  }

  /**
   * Arrête proprement le tunnel et libère les ressources
   * @returns {Promise<boolean>}
   */
  async stopTunnel() {
    dbg(`[${this.id}] Arrêt propre demandé...`)
    this.isActive = false
    this.tunnelInfo = null
    this.emit('disconnection')
    return true
  }

  /**
   * Injecte une position GPS
   * @param {number} lat 
   * @param {number} lon 
   * @param {string} [name] 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async setLocation(lat, lon, name) {
    throw new Error(`Method setLocation() not implemented for driver ${this.id}`)
  }

  /**
   * Supprime la simulation GPS
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async clearLocation() {
    throw new Error(`Method clearLocation() not implemented for driver ${this.id}`)
  }

  /**
   * Retourne les infos de connexion actuelles
   */
  getTunnelInfo() {
    return this.tunnelInfo
  }
}

module.exports = BaseDriver
