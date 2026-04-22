'use strict'

const { app, BrowserWindow } = require('electron')
const path = require('path')
const { setWindow } = require('./logger')
const tunnel = require('./tunneld-manager')
const GpsSimulator = require('./services/gps-simulator')
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
  mainWindow.loadFile('index.html')

  // Injecter la référence fenêtre dans le logger
  setWindow(mainWindow)
}

app.whenReady().then(() => {
  createWindow()
  
  // Initialisation des services
  gps = new GpsSimulator(tunnel)
  
  // Enregistre les handlers IPC
  registerIpcHandlers(tunnel, gps)
  
  // Liaison Tunnel -> GPS pour la restauration automatique
  tunnel.setOnTunnelRestored(() => gps.onTunnelRestored())

  const initialSettings = require('./services/settings-manager').get()
  
  // Appliquer les réglages initiaux (IP Wifi, etc.)
  tunnel.setWifiIpOverride(initialSettings.wifiIp, initialSettings.wifiPort)
  
  tunnel.startTunneld(initialSettings)
})

app.on('before-quit', () => {
  tunnel.setQuitting()
})

app.on('window-all-closed', () => {
  tunnel.setQuitting()
  if (gps) gps.destroy()
  tunnel.stopTunneld()
  app.quit()
})

module.exports = { createWindow }
