'use strict'

/**
 * tunneld-manager.js (L'Orchestrateur Maître)
 * 
 * Hiérarchie de connexion :
 * 1. USB (UsbConnector)
 * 2. Bonjour WiFi IPv6 (BonjourConnector)
 * 3. TunnelId Fallback (TunneldConnector)
 */

const { dbg } = require('./logger')
const ConnectionState = require('./tunneld/connection-state')
const UsbConnector = require('./services/connectors/usb-connector')
const BonjourConnector = require('./services/connectors/wifi-connector')
const TunneldConnector = require('./services/connectors/tunneld-connector')
const { PYTHON } = require('./python-resolver')
const ProcessRunner = require('./utils/process-runner')

class ConnectionOrchestrator {
  constructor() {
    this.usb = new UsbConnector()
    this.bonjour = new BonjourConnector()
    this.tunneld = new TunneldConnector()
    this.heartbeatRunners = new Map()
    
    this.state = new ConnectionState(() => {
      if (this._onTunnelRestoredCb) this._onTunnelRestoredCb()
      if (this._onStatusChangeCb) this._onStatusChangeCb(true)
    })

    this._onTunnelRestoredCb = null
    this._onStatusChangeCb = null
    this._isQuitting = false

    this._initListeners()
  }

  _initListeners() {
    // Événements USB (Priorité 1)
    this.usb.on('connection', (conn) => {
      dbg(`[orchestrator] USB Prioritaire detecte.`)
      this.bonjour.stop()
      this.tunneld.stop()
      this._handleNewConnection(conn, 'USB')
    })
    this.usb.on('disconnection', () => this._handleDisconnection('USB'))

    // Événements Bonjour (Priorité 2)
    this.bonjour.on('connection', (conn) => {
      if (this.usb.activeConnection) return // USB gagne
      dbg(`[orchestrator] WiFi Bonjour detecte.`)
      this.tunneld.stop()
      this._handleNewConnection(conn, 'WiFi')
    })

    // Événements Tunneld (Priorité 3)
    this.tunneld.on('connection', (conn) => {
      if (this.usb.activeConnection || this.bonjour.activeConnection) return // USB ou Bonjour gagnent
      this._handleNewConnection(conn, conn.type)
    })
  }

  start() {
    if (this._isQuitting) return
    dbg('[orchestrator] Demarrage de la sequence de decouverte...')
    
    // 1. On lance toujours l'USB (il ecoute passivement)
    this.usb.start()

    // 2. Apres 5s, si rien en USB, on lance Bonjour
    setTimeout(() => {
      if (!this.state.isConnected && !this._isQuitting) {
        this.bonjour.start()
      }
    }, 5000)

    // 3. Apres 15s, si toujours rien, on lance le Fallback TunnelId
    setTimeout(() => {
      if (!this.state.isConnected && !this._isQuitting) {
        this.tunneld.start()
      }
    }, 15000)
  }

  _handleNewConnection(conn, type) {
    this.state.setConnected(conn.address, conn.port, type)
    if (conn.deviceInfo) {
        // Optionnel : mise à jour des infos device
    }
    this._startRsdHeartbeat(conn.address, conn.port)
  }

  _handleDisconnection(source) {
    dbg(`[orchestrator] Deconnexion detectee via ${source}`)
    this.state.setDisconnected(`Deconnecte de ${source}`)
    this._stopAllHeartbeats()
    if (this._onStatusChangeCb) this._onStatusChangeCb(false)
    
    if (this._isQuitting) return

    if (source === 'USB') {
      dbg('[orchestrator] Chute de la Priorite 1 (USB) -> Basculement immediat sur Priorite 2 (Bonjour)')
      this.bonjour.start()
      
      // On lance aussi le timer pour le fallback TunnelId plus tard
      setTimeout(() => {
        if (!this.state.isConnected && !this._isQuitting) {
          this.tunneld.start()
        }
      }, 10000)
    } else {
      // Pour les autres deconnexions, on relance le cycle normal
      this.start()
    }
  }

  _startRsdHeartbeat(address, port) {
    const key = `${address}:${port}`
    if (this.heartbeatRunners.has(key)) return
    
    dbg(`[orchestrator] Battement de coeur (RSD) sur ${address}:${port}...`)
    
    // Règle d'or : Pas de crochets pour IPv6 car host et port sont séparés
    const args = ['-m', 'pymobiledevice3', 'lockdown', 'heartbeat', '--rsd', address, port]

    const hbRunner = new ProcessRunner(`hb-${address.slice(0,8)}`)
    hbRunner.spawn(PYTHON, args)
    this.heartbeatRunners.set(key, hbRunner)

    hbRunner.on('exit', () => {
      if (this.heartbeatRunners.get(key) === hbRunner) {
        this.heartbeatRunners.delete(key)
      }
    })
  }

  _stopAllHeartbeats() {
    for (const [key, runner] of this.heartbeatRunners) {
      runner.stop()
    }
    this.heartbeatRunners.clear()
  }

  // --- API Façade pour le reste de l'app ---
  startTunneld() { this.start() }
  stopTunneld() { 
    this.usb.stop()
    this.bonjour.stop()
    this.tunneld.stop()
    this._stopAllHeartbeats()
    this.state.reset()
  }
  setQuitting() {
    this._isQuitting = true
    this.usb.destroy()
    this.bonjour.destroy()
    this.tunneld.destroy()
    this._stopAllHeartbeats()
  }

  // Ces méthodes restent pour la compatibilité avec GpsSimulator et CompanionServer
  getRsdAddress() { return this.state.address }
  getRsdPort() { return this.state.port }
  getConnectionType() { return this.state.type }
  getDeviceInfo() { return this.usb.deviceInfo || { name: 'iPhone', version: 'Inconnue', type: 'Inconnu', paired: false } }
  stopHeartbeats() { this._stopAllHeartbeats() }
  forceRefresh() { this.stopTunneld(); this.start() }
  setOnTunnelRestored(cb) { this._onTunnelRestoredCb = cb }
  setOnStatusChange(cb) { this._onStatusChangeCb = cb }
  
  // Cette méthode est maintenant décorrélée de l'initialisation du tunnel
  setWifiIpOverride(ip) {
    dbg(`[orchestrator] Info WebSocket recue : iPhone sur ${ip} (Stocke pour info uniquement)`)
  }
}

module.exports = new ConnectionOrchestrator()
