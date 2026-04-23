'use strict'

const { app, BrowserWindow } = require('electron')
const path = require('path')
const { setWindow, dbg } = require('./logger')
const tunnel = require('./tunneld-manager')
const GpsSimulator = require('./services/gps-simulator')
const companionServer = require('./services/companion-server')
const { registerIpcHandlers } = require('./ipc/registry')

let mainWindow
let gps
let companion

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
      const prodPath = path.join(__dirname, '..', '..', 'dist-web', 'renderer-v2', 'index.html')
      mainWindow.loadFile(prodPath)
    })
  } else {
    const prodPath = path.join(__dirname, '..', '..', 'dist-web', 'renderer-v2', 'index.html')
    const fallbackPath = path.join(app.getAppPath(), 'dist-web', 'renderer-v2', 'index.html')
    
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
  companion = new companionServer(tunnel)
  
  // Enregistre les handlers IPC
  registerIpcHandlers(tunnel, gps, companion)
  
  // Liaison Tunnel -> GPS pour la restauration automatique
  tunnel.setOnTunnelRestored(() => gps.onTunnelRestored())
  
  const initialSettings = require('./services/settings-manager').get()
  
  // Appliquer les réglages initiaux (IP Wifi, etc.)
  tunnel.setWifiIpOverride(initialSettings.wifiIp, initialSettings.wifiPort)
  
  // Liaison Tunnel -> Companion
  tunnel.setOnStatusChange((active) => companion.updateTunnelStatus(active))

  gps.on('location-changed', ({ lat, lon, name }) => {
    tunnel.stopHeartbeats() // On arrête les heartbeats pour laisser la simulation prioritaire
    companion.broadcastLocation(lat, lon, name)
  })

  gps.on('log', (msg) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'server-log', state: 'new', data: msg })
  })

  // Liaison Companion -> GPS (Demande de l'iPhone vers le PC)
  companion.on('request-location', ({ lat, lon }) => {
    gps.setLocation(lat, lon, "Position iPhone")
    // Notifier le renderer pour mettre à jour la carte sur le PC
    if (mainWindow) {
        mainWindow.webContents.send('status-update', { 
            service: 'location', 
            state: 'active', 
            data: { lat, lon, name: "iPhone Remote" } 
        })
    }
  })

  // Liaison Companion -> Tunnel (Information uniquement)
  companion.on('iphone-ip-detected', (ip) => {
    tunnel.setWifiIpOverride(ip)
  })

  // Liaison Companion -> Renderer (Synchro Favoris & Historique temps réel)
  companion.on('favorites-updated', (favs) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'favorites', state: 'updated', data: favs })
  })

  companion.on('history-updated', (history) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'history', state: 'updated', data: history })
  })

  companion.on('client-log', (log) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'client-log', state: 'new', data: log })
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
