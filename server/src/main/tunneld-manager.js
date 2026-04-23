'use strict'

/**
 * tunneld-manager.js (Orchestrateur Unifié)
 *
 * Centralise la gestion des tunnels via un seul démon (tunneld)
 * qui gère nativement l'USB et le WiFi.
 */

const { dbg } = require('./logger')
const ConnectionState = require('./tunneld/connection-state')
const TunneldService = require('./tunneld/tunneld-service')

// ─── État Global ──────────────────────────────────────────────────────────────

let _isQuitting = false
let _onTunnelRestoredCb = null
let _onStatusChangeCb = null

const state = new ConnectionState(() => {
  if (_onTunnelRestoredCb) _onTunnelRestoredCb()
  if (_onStatusChangeCb) _onStatusChangeCb(true)
})

const service = new TunneldService()
let _manualIp = null

// ─── Configuration des événements ─────────────────────────────────────────────

service.on('connection', ({ address, port, type }) => {
  // L'orchestrateur met à jour l'état global.
  // Si on est déjà connecté en USB, et qu'une connexion WiFi arrive, 
  // on privilégie l'USB pour la stabilité, ou on accepte le switch.
  state.setConnected(address, port, type)
})

service.on('disconnection', (reason) => {
  const wasWiFi = state.type === 'WiFi'
  state.setDisconnected(reason)
  
  // Si on a perdu le WiFi, on relance immédiatement une recherche agressive
  if (wasWiFi && !_isQuitting) {
    dbg('[tunneld-manager] WiFi déconnecté. Relance immédiate de la découverte...')
    service.start()
  }
  if (_onStatusChangeCb) _onStatusChangeCb(false)
})

service.on('error', (msg) => {
  // On pourrait logguer plus précisément les erreurs tunnel
})

// ─── API Publique ─────────────────────────────────────────────────────────────

/**
 * Démarre le service global de gestion des tunnels
 */
function startTunneld(settings = {}) {
  if (_isQuitting) return
  
  // Dans cette nouvelle architecture, on démarre le service unique
  // qui détectera automatiquement les appareils branchés ou sur le réseau.
  _manualIp = settings.wifiIp || null
  service.start(_manualIp)
}

/**
 * Arrête tout
 */
function stopTunneld() {
  service.stop()
  state.reset()
}

function setQuitting() {
  _isQuitting = true
  service.destroy()
}

/**
 * Obsolète dans l'architecture unifiée, gardé pour compatibilité IPC
 * car tunneld gère lui-même les IP via mDNS.
 */
function setWifiIpOverride(ip, port) {
  // Si le tunnel est déjà établi et que c'est la même IP, on ne touche à rien
  if (state.isConnected && state.address === ip) {
    return
  }

  // Si on a déjà tenté cette IP récemment et que le service tourne, on attend
  if (_manualIp === ip && service.isRunning) {
    return
  }
  
  dbg(`[tunneld-manager] Nouvelle IP detectee (${ip}), mise a jour du service...`)
  _manualIp = ip
  service.start(_manualIp)
}

function applyConnectionMode(mode) {
  // Optionnel : on pourrait filtrer les évènements 'connection' selon le mode
}

function forceRefresh() {
  service.stop()
  service.start()
}

function setOnTunnelRestored(cb) { _onTunnelRestoredCb = cb }

module.exports = {
  startTunneld,
  stopTunneld,
  setQuitting,
  setWifiIpOverride,
  applyConnectionMode,
  forceRefresh,
  getRsdAddress: () => state.address,
  getRsdPort: () => state.port,
  getConnectionType: () => state.type,
  stopHeartbeats: () => service.stopHeartbeats(),
  setOnTunnelRestored,
  setOnStatusChange: (cb) => { _onStatusChangeCb = cb },
}
