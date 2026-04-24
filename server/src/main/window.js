'use strict'

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const { setWindow, dbg } = require('./logger')
const tunnel = require('./tunneld-manager')
const GpsSimulator = require('./services/gps/gps-simulator')
const companionServer = require('./services/companion-server')
const { registerIpcHandlers } = require('./ipc/registry')

let mainWindow
let gps
let companion
let tray
let isQuitting = false

function createTray() {
  // On peut utiliser une icône vide ou un symbole en attendant l'icône finale
  const iconPath = path.join(__dirname, '..', '..', 'resources', 'icon.png')
  let icon = nativeImage.createFromPath(iconPath)
  
  if (icon.isEmpty()) {
    // Fallback: petite icône de remplacement (point bleu) si l'icône n'est pas trouvée
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Ouvrir GPS Mock', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quitter', click: () => {
        isQuitting = true
        app.quit()
      } 
    }
  ])

  tray.setToolTip('GPS Mock — iPhone Location Spoofer')
  tray.setContextMenu(contextMenu)
  
  tray.on('double-click', () => {
    mainWindow.show()
  })
}

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
    // On cache la fenêtre au lieu de la détruire lors de la fermeture
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      return false
    }
  })

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000').catch(() => {
      mainWindow.loadFile(path.join(__dirname, '../../dist-web/renderer-v2/index.html'))
    })
  } else {
    // Chemin standard pour une application empaquetée
    const indexPath = path.join(app.getAppPath(), 'dist-web', 'renderer-v2', 'index.html')
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('Erreur chargement production:', err)
    })
  }

  setWindow(mainWindow)
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  
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
    tunnel.stopHeartbeats() 
    companion.broadcastLocation(lat, lon, name)
  })

  gps.on('log', (msg) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'server-log', state: 'new', data: msg })
  })

  companion.on('request-location', ({ lat, lon, name }) => {
    gps.setLocation(lat, lon, name || "Position iPhone")
    if (mainWindow) {
        mainWindow.webContents.send('status-update', { 
            service: 'location', 
            state: 'active', 
            data: { lat, lon, name: "iPhone Remote" } 
        })
    }
  })

  companion.on('iphone-ip-detected', (ip) => {
    tunnel.setWifiIpOverride(ip)
  })

  companion.on('favorites-updated', (favs) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'favorites', state: 'updated', data: favs })
  })

  companion.on('history-updated', (history) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'history', state: 'updated', data: history })
  })

  companion.on('client-log', (log) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'client-log', state: 'new', data: log })
  })

  companion.start(initialSettings.companionPort)
  
  tunnel.startTunneld(initialSettings)
})

app.on('before-quit', () => {
  isQuitting = true
  tunnel.setQuitting()
})

app.on('window-all-closed', () => {
  // Sur Windows, on ne quitte pas si on a le tray
  if (process.platform !== 'darwin' && !isQuitting) {
    // On ne fait rien, la fenêtre est juste cachée
  } else {
    tunnel.setQuitting()
    if (gps) gps.destroy()
    companion.stop()
    tunnel.stopTunneld()
    app.quit()
  }
})

module.exports = { createWindow }
