'use strict'

const { app, BrowserWindow } = require('electron')
const path = require('path')
const { setWindow } = require('./logger')
const tunnel = require('./tunneld-manager')
const GpsSimulator = require('./services/gps-simulator')
const companion = require('./services/companion-server')
const { registerIpcHandlers } = require('./ipc/registry')

let mainWindow
let gps

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'GPS Mock — iPhone Location Spoofer',
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000').catch(() => {
      // Si le serveur de dev n'est pas lancé, on charge le build local
      const prodPath = path.join(__dirname, '..', '..', 'dist-web', 'index.html')
      mainWindow.loadFile(prodPath)
    })
  } else {
    const prodPath = path.join(__dirname, '..', '..', 'dist-web', 'index.html')
    const fallbackPath = path.join(app.getAppPath(), 'dist-web', 'index.html')
    
    mainWindow.loadFile(prodPath).catch(() => {
      mainWindow.loadFile(fallbackPath)
    })
  }

  // Injecter la référence fenêtre dans le logger
  setWindow(mainWindow)
}

app.whenReady().then(() => {
  createWindow()
  
  // Initialisation des services
  gps = new GpsSimulator(tunnel)
  
  // Enregistre les handlers IPC
  registerIpcHandlers(tunnel, gps, companion)
  
  // Liaison Tunnel -> GPS pour la restauration automatique
  tunnel.setOnTunnelRestored(() => gps.onTunnelRestored())
  
  const initialSettings = require('./services/settings-manager').get()
  
  // Appliquer les réglages initiaux (IP Wifi, etc.)
  tunnel.setWifiIpOverride(initialSettings.wifiIp, initialSettings.wifiPort)
  
  // Liaison Tunnel -> Companion
  tunnel.setOnStatusChange((active) => companion.updateTunnelStatus(active))

  // Liaison GPS -> Companion (Broadcast de la position vers l'iPhone)
  gps.on('location-changed', ({ lat, lon, name }) => {
    tunnel.stopHeartbeats() // On arrête les heartbeats pour laisser la simulation prioritaire
    companion.broadcastLocation(lat, lon, name)
  })

  // Liaison Companion -> GPS (Demande de l'iPhone vers le PC)
  companion.on('request-location', ({ lat, lon }) => {
    gps.setLocation(lat, lon, "Position iPhone")
  })

  // Liaison Companion -> Tunnel (Aide à la découverte WiFi)
  companion.on('iphone-ip-detected', (ip) => {
    dbg(`[main] Aide à la découverte : iPhone détecté sur ${ip}. Tentative RSD...`)
    tunnel.setWifiIpOverride(ip)
  })

  companion.start(initialSettings.companionPort) // Démarrer le serveur WebSocket
  
  tunnel.startTunneld(initialSettings)
})

app.on('before-quit', () => {
  tunnel.setQuitting()
})

app.on('window-all-closed', () => {
  tunnel.setQuitting()
  if (gps) gps.destroy()
  companion.stop()
  tunnel.stopTunneld()
  app.quit()
})

module.exports = { createWindow }
