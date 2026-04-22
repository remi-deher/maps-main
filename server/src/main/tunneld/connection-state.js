'use strict'

const { dbg, sendStatus } = require('../logger')

/**
 * Gère l'état global de la connexion RSD (USB/WiFi)
 * et applique les règles de priorité (Preemption).
 */
class ConnectionState {
  constructor(onRestoredCb) {
    this.address = null
    this.port = null
    this.type = null // 'USB' | 'WiFi' | 'Network' | null
    this.onRestoredCb = onRestoredCb
    this.lastKnownRsdPort = null
  }

  get isConnected() {
    return !!this.address && !!this.port
  }

  /**
   * Tente d'enregistrer une nouvelle connexion.
   * Priorité absolue à l'USB.
   */
  setConnected(address, port, type) {
    const prevType = this.type
    
    // Règle de préemption : Si on est déjà en WiFi et qu'on reçoit un "Network" 
    // venant du daemon USB, on l'ignore pour rester stable sur notre WiFi manuel.
    if (this.type === 'WiFi' && type === 'Network') {
      dbg(`[state] ignore device ${type} — déjà stable sur WiFi`)
      return false
    }

    this.address = address
    this.port = port
    this.type = type
    
    if (port) this.lastKnownRsdPort = port

    if (prevType && prevType !== type) {
      dbg(`[state] basculement ${prevType} → ${type}`)
    }

    dbg(`[state] RSD actif (${type}) → ${address}:${port}`)
    sendStatus('tunneld', 'ready', `Tunnel actif (${type}) → ${address}:${port}`, { type })

    if (this.onRestoredCb) this.onRestoredCb()
    return true
  }

  setDisconnected(reason) {
    const wasType = this.type
    this.address = null
    this.port = null
    this.type = null
    
    dbg(`[state] déconnexion (${reason}) — était ${wasType || 'inconnu'}`)
    sendStatus('tunneld', 'stopped', 'iPhone déconnecté — simulation GPS maintenue')
  }

  reset() {
    this.address = null
    this.port = null
    this.type = null
  }
}

module.exports = ConnectionState
