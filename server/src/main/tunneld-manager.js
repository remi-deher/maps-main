'use strict'

/**
 * tunneld-manager.js (L'Orchestrateur Maître - Version Résiliente)
 * Gère la cascade de priorités : USB > WebSocket IP > Bonjour > Daemon
 * Version optimisée pour la stabilité maximale (Landsat 10)
 */

const { dbg, sendStatus } = require('./logger')
const tunneldService = require('./tunneld/tunneld-service')
const gpsBridge = require('./services/gps/gps-bridge')
const { EventEmitter } = require('events')

class ConnectionOrchestrator extends EventEmitter {
  constructor() {
    super()
    this.daemon = tunneldService
    
    this.activeConnection = null
    this.heartbeatRunners = new Map()
    this.discoveryTimer = null
    this.isUsbLocked = false
    this.isCompanionConnected = false
    this.companionIp = null
    this._isQuitting = false
    
    this._onTunnelRestoredCb = null
    this._onStatusChangeCb = null

    this._initListeners()
  }

  _initListeners() {
    // Événements du Service (USB & WiFi)
    this.daemon.on('connection', (conn) => {
      // Priorité 1 : USB (Priorité absolue)
      if (conn.type === 'USB') {
        dbg('[orchestrator] Priorité 1 : USB détectée via le service. Verrouillage.')
        this.isUsbLocked = true
        if (this.discoveryTimer) {
          clearTimeout(this.discoveryTimer)
          this.discoveryTimer = null
        }
        this._handleNewConnection(conn)
      } 
      // Priorité 2, 3 et 4 : WiFi
      else {
        if (!this.isUsbLocked) {
          dbg(`[orchestrator] Connexion WiFi acceptée : ${conn.address}`)
          this._handleNewConnection(conn)
        } else {
          dbg('[orchestrator] Connexion WiFi ignorée car l\'USB est prioritaire et verrouillé.')
        }
      }
    })

    this.daemon.on('disconnection', () => {
      dbg('[orchestrator] Déconnexion détectée du service tunnel.')
      this.isUsbLocked = false
      this._handleDisconnection()
    })
  }

  /**
   * Hint WebSocket : IP Certifiée reçue du compagnon iOS.
   * Sert à accélérer le tunneld si le scan auto est trop lent.
   */
  handleIphoneIpDetected(ip) {
    if (this.isUsbLocked) return
    dbg(`[orchestrator] Hint WebSocket reçu (${ip}).`)
    this.isCompanionConnected = true
    this.companionIp = ip
    
    // Si un tunnel est déjà prêt, on peut lancer le heartbeat sur cette nouvelle IP
    if (this.activeConnection) {
      this._startHeartbeatCycle()
    }
  }

  _handleNewConnection(conn) {
    // Si on change de type de connexion (ex: WiFi -> USB), on nettoie tout
    if (this.activeConnection && this.activeConnection.type !== conn.type) {
      dbg(`[orchestrator] Changement de mode : ${this.activeConnection.type} -> ${conn.type}`)
      this._stopAllHeartbeats()
    }

    if (this.activeConnection?.address === conn.address && this.activeConnection?.port === conn.port) return

    this.activeConnection = conn
    
    // Annulation du timer de découverte si une connexion est établie
    if (this.discoveryTimer) {
      clearTimeout(this.discoveryTimer)
      this.discoveryTimer = null
    }

    dbg(`[orchestrator] Connexion active : ${conn.type} (${conn.address}:${conn.port})`)

    sendStatus('tunneld', 'ready', `Connecté via ${conn.type}`, {
      type: conn.type,
      device: conn.deviceInfo || { name: 'iPhone' }
    })

    // On ne lance le heartbeat QUE si le compagnon (WebSocket) est là
    if (this.isCompanionConnected) {
      this._startHeartbeatCycle()
    } else {
      dbg('[orchestrator] Tunnel prêt, en attente du WebSocket pour le heartbeat...')
    }

    if (this._onTunnelRestoredCb) this._onTunnelRestoredCb()
    if (this._onStatusChangeCb) this._onStatusChangeCb(true)
    this.emit('ready', conn)
  }

  _startHeartbeatCycle() {
    this._stopAllHeartbeats()
    if (!this.activeConnection || !this.companionIp) return

    const ip = this.companionIp
    const port = this.activeConnection.port
    
    dbg(`[orchestrator] Lancement du cycle Heartbeat (Bridge) sur l'IP WebSocket : ${ip}:${port}`)
    
    const hbInterval = setInterval(async () => {
      if (!this.activeConnection || this.companionIp !== ip) {
        clearInterval(hbInterval)
        return
      }

      // On passe par le pont Python pour le heartbeat
      const result = await gpsBridge.sendCommand('heartbeat', ip, port)
      if (!result.success) {
        dbg(`[orchestrator] Heartbeat échoué sur ${ip} : ${result.error}`)
      }
    }, 10000)

    this.heartbeatRunners.set('active', { stop: () => clearInterval(hbInterval) })
  }

  _handleDisconnection() {
    if (!this.activeConnection) return
    
    const wasUsb = this.isUsbLocked
    dbg(`[orchestrator] Déconnexion détectée (${this.activeConnection.type})`)
    
    this.activeConnection = null
    this.isUsbLocked = false
    this._stopAllHeartbeats()
    
    sendStatus('tunneld', 'scanning', 'Connexion perdue, recherche...')

    if (this._onStatusChangeCb) this._onStatusChangeCb(false)
    this.emit('lost')

    // Si on a perdu l'USB, on relance immédiatement la découverte WiFi
    if (!this._isQuitting) {
      dbg('[orchestrator] Tentative de remontée du tunnel après déconnexion...')
      this.start()
    }
  }

  _stopAllHeartbeats() {
    this.daemon.stopHeartbeats()
    for (const hb of this.heartbeatRunners.values()) {
      hb.stop()
    }
    this.heartbeatRunners.clear()
  }

  /**
   * Démarre la cascade de découverte
   */
  start() {
    if (this._isQuitting) return
    dbg('[orchestrator] Démarrage de la cascade de découverte (USB > WS IP > Bonjour > Daemon)...')
    
    // Lancement des services annexes
    gpsBridge.start()

    // Phase 1 : Démarrage du démon tunneld de base (USB + Discovery passive)
    this.daemon.start()

    // Phase 2 : Planification de la découverte Bonjour après un délai de 5s
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer)
    this.discoveryTimer = setTimeout(() => {
      if (!this.activeConnection && !this.isUsbLocked) {
        dbg('[orchestrator] Phase 2 : Pas de connexion après 5s, déclenchement du scan Bonjour...')
        this.daemon._triggerNativeFallback(null)
      }
    }, 5000)

    sendStatus('tunneld', 'scanning', 'Recherche d\'un iPhone (Cascade active)...')
  }

  stopTunneld() {
    this.daemon.stop()
    this._stopAllHeartbeats()
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer)
    this.activeConnection = null
    this.isUsbLocked = false
  }

  setQuitting() {
    this._isQuitting = true
    this.stopTunneld()
  }

  // API Publique (Façade)
  getRsdAddress() { return this.activeConnection?.address }
  getRsdPort() { return this.activeConnection?.port }
  getConnectionType() { return this.activeConnection?.type }
  getDeviceInfo() { return this.activeConnection?.deviceInfo || { name: 'iPhone', version: 'Inconnue' } }
  
  forceRefresh() { this.stopTunneld(); this.start() }
  startTunneld() { this.start() }
  applyConnectionMode(mode) { dbg(`[orchestrator] Mode demandé : ${mode}`) }
  
  // Interface pour le compagnon WebSocket (Priorité 2)
  setWifiIpOverride(ip) { this.handleIphoneIpDetected(ip) }

  setOnTunnelRestored(cb) { this._onTunnelRestoredCb = cb }
  setOnStatusChange(cb) { this._onStatusChangeCb = cb }
}

module.exports = new ConnectionOrchestrator()
