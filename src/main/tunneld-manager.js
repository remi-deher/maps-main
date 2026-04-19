'use strict'

/**
 * tunneld-manager.js (Orchestrateur)
 *
 * Centralise la gestion des tunnels USB et WiFi en déléguant
 * la logique basse niveau aux sous-modules du dossier ./tunneld/
 */

const ConnectionState = require('./tunneld/connection-state')
const UsbBus = require('./tunneld/usb-bus')
const WifiBus = require('./tunneld/wifi-bus')
const { WIFI_RETRY_DELAY } = require('./constants')

// ─── État Global ──────────────────────────────────────────────────────────────

let _isQuitting = false
let _onTunnelRestoredCb = null

const state = new ConnectionState(() => {
  if (_onTunnelRestoredCb) _onTunnelRestoredCb()
})

const usb = new UsbBus()
const wifi = new WifiBus()

// ─── Configuration des événements ─────────────────────────────────────────────

// Liaison USB -> State
usb.on('connection', ({ address, port, type }) => {
  const success = state.setConnected(address, port, type)
  if (success && type === 'USB') {
    wifi.stop()
  }
})

usb.on('disconnection', (reason) => {
  if (state.type === 'USB') {
    state.setDisconnected(reason)
    // Basculement WiFi rapide
    wifi.scheduleRetry(500)
  }
})

// Liaison WiFi -> State
wifi.on('connection', ({ address, port, type }) => {
  state.setConnected(address, port, type)
})

wifi.on('failure', (msg) => {
  // Optionnel : on pourrait envoyer un status spécifique si besoin
})

// Partage du port USB vers WiFi (Smart Port)
// On observe les changements d'état pour synchroniser le dernier port connu
const originalSetConnected = state.setConnected.bind(state)
state.setConnected = (address, port, type) => {
  const res = originalSetConnected(address, port, type)
  if (res && port) wifi.lastKnownPort = port
  return res
}

// ─── API Publique ─────────────────────────────────────────────────────────────

function startTunneld(settings = {}) {
  if (_isQuitting) return
  
  const mode = settings.connectionMode || 'both'

  if (mode === 'both' || mode === 'usb') {
    usb.start()
  } else {
    usb.stop()
  }

  if (mode === 'both' || mode === 'wifi') {
    // Au démarrage, on tente aussi le WiFi si pas encore de connexion
    if (!state.isConnected) wifi.scheduleRetry(500)
  } else {
    wifi.stop()
  }
}

function stopTunneld() {
  usb.stop()
  wifi.stop()
  state.reset()
}

function setQuitting() {
  _isQuitting = true
  usb.destroy()
  wifi.destroy()
}

function setWifiIpOverride(ip, port) {
  const prevIp = wifi.ipOverride
  wifi.setOverrides(ip, port)

  // Si l'IP change, on relance le WiFi
  if (prevIp !== wifi.ipOverride) {
    if (state.type === 'WiFi') state.setDisconnected('Changement IP Config')
    wifi.stop()
    wifi.scheduleRetry(500)
  } else if (!state.isConnected && wifi.ipOverride) {
    // On ne force le retry que si le Wifi est activé dans les settings
    // Mais cette fonction est appelée après saveSettings qui s'occupe de la logique globale
  }
}

function applyConnectionMode(mode) {
  if (mode === 'usb') {
    wifi.stop()
    if (state.type === 'WiFi') state.setDisconnected('Mode USB uniquement')
    usb.start()
  } else if (mode === 'wifi') {
    usb.stop()
    if (state.type === 'USB') state.setDisconnected('Mode WiFi uniquement')
    wifi.scheduleRetry(500)
  } else {
    // both
    usb.start()
    if (!state.isConnected) wifi.scheduleRetry(500)
  }
}

function setOnTunnelRestored(cb) { _onTunnelRestoredCb = cb }

module.exports = {
  startTunneld,
  stopTunneld,
  setQuitting,
  setWifiIpOverride,
  applyConnectionMode,
  getRsdAddress: () => state.address,
  getRsdPort: () => state.port,
  getConnectionType: () => state.type,
  setOnTunnelRestored,
}
