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

let firstHide = true

function createTray() {
  const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png')
  let icon = nativeImage.createFromPath(iconPath)
  
  if (icon.isEmpty()) {
    dbg(`[tray] ⚠️ Icône non trouvée à : ${iconPath}`)
    icon = nativeImage.createEmpty()
  } else {
    dbg(`[tray] Icône chargée : ${iconPath}`)
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: '📍 GPS Mock — Actif', 
      enabled: false 
    },
    { type: 'separator' },
    { label: 'Ouvrir l\'interface', click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show()
          mainWindow.focus()
        }
    } },
    { label: 'Cacher', click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide()
        }
    } },
    { type: 'separator' },
    { label: 'Quitter l\'application', click: () => {
        isQuitting = true
        app.quit()
      } 
    }
  ])

  tray.setToolTip('GPS Mock — iPhone Location Spoofer (Actif en arrière-plan)')
  tray.setContextMenu(contextMenu)
  
  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function showTrayNotification() {
  if (firstHide && tray) {
    tray.displayBalloon({
      title: 'GPS Mock tourne en arrière-plan',
      content: 'L\'application reste active pour maintenir la simulation GPS. Utilisez l\'icône dans la barre des tâches pour l\'ouvrir à nouveau.',
      iconType: 'info'
    })
    firstHide = false
  }
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
      showTrayNotification()
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
  
  const initialSettings = require('./services/settings-manager').get()
  
  // Appliquer les réglages initiaux (IP Wifi, etc.)
  tunnel.setWifiIpOverride(initialSettings.wifiIp, initialSettings.wifiPort)
  
  // Liaison Tunnel -> Companion
  tunnel.setOnStatusChange((active) => companion.updateTunnelStatus(active))

  gps.on('location-changed', ({ lat, lon, name }) => {
    companion.broadcastLocation(lat, lon, name)
    companion.confirmLocationApplied(lat, lon, name)
  })

  gps.on('log', (msg) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'server-log', state: 'new', data: msg })
  })

  // --- AUTOMATISATION : Re-appliquer la position dès que le tunnel est prêt ---
  tunnel.on('ready', (conn) => {
    if (gps.lastCoords) {
      const { lat, lon, name } = gps.lastCoords
      dbg(`[window] 🔄 Tunnel prêt (${conn.type}). Ré-application automatique de la position en attente : ${lat}, ${lon}`)
      gps.setLocation(lat, lon, name)
    }
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

  let ipDetectTimer = null
  companion.on('iphone-ip-detected', (ip) => {
    if (ipDetectTimer) clearTimeout(ipDetectTimer)
    
    dbg(`[window] 📱 iPhone détecté (${ip}). Attente de stabilisation (3s)...`)
    tunnel.setWifiIpOverride(ip)
    
    ipDetectTimer = setTimeout(() => {
      // Éviter de relancer si le tunnel est déjà en train de monter ou prêt
      if (tunnel.isStarting() || !!tunnel.getRsdAddress()) {
        dbg(`[window] 📱 Connexion déjà en cours ou prête. Pas de relance nécessaire.`)
      } else {
        dbg(`[window] 📱 Connexion stable. Rafraîchissement du tunnel Go-iOS...`)
        tunnel.forceRefresh()
      }
      ipDetectTimer = null
    }, 3000)
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
  if (tray) tray.destroy()
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
