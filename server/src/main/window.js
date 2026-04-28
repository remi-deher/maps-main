'use strict'

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron')
const path = require('path')
const { setWindow, dbg } = require('./logger')
const tunnel = require('./tunneld-manager')
const GpsSimulator = require('./services/gps/gps-simulator')
const companionServer = require('./services/companion-server')
const settings = require('./services/settings-manager')
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
      preload: path.join(__dirname, 'preload.js'),
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

  const isDev = process.env.NODE_ENV === 'development'
  const indexPath = path.join(__dirname, '../../dist-web/renderer-v2/index.html')

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000').catch(() => {
      mainWindow.loadFile(indexPath)
    })
  } else {
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('Erreur chargement UI:', err)
    })
  }

  setWindow(mainWindow)
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  
  // Initialisation des services
  companion = new companionServer(tunnel)
  gps = new GpsSimulator(tunnel, companion)
  
  // Enregistre les handlers IPC
  registerIpcHandlers(tunnel, gps, companion)
  
  const initialSettings = settings.get()
  let clusterManager = null
  
  try {
    clusterManager = require('./services/cluster-manager')
    clusterManager.init()

    // --- ÉVÉNEMENTS CLUSTER ---
    clusterManager.on('role-changed', (role) => {
      dbg(`[window] 🎭 Changement de rôle Cluster : ${role.toUpperCase()}`)
      if (mainWindow) mainWindow.webContents.send('status-update', { service: 'cluster', state: role })
      
      if (role === 'master') {
        tunnel.start()
        if (initialSettings.operationMode !== 'autonomous') {
          companion.start(initialSettings.companionPort)
        }
      } else {
        tunnel.stop()
        companion.stop()
      }
    })

    companion.on('cluster-sync', ({ lat, lon, name, mode }) => {
      if (clusterManager.role === 'slave') {
        gps.lastCoords = { lat, lon, name }
        if (mainWindow) {
          mainWindow.webContents.send('status-update', { 
              service: 'location', 
              state: 'synced', 
              data: { lat, lon, name: name + " (Sync Master)" } 
          })
        }
      }
    })

    ipcMain.handle('takeover-cluster', async () => {
      await clusterManager.takeover()
      return { success: true }
    })

    clusterManager.on('status-updated', (status) => {
      if (mainWindow) mainWindow.webContents.send('status-update', { service: 'cluster-dashboard', state: 'sync', data: status })
    })

    companion.on('settings-updated', (newSettings) => {
        // Appeler les mêmes logiques que save-settings mais sans sauvegarder (car déjà fait par settings-updated)
        if (mainWindow) mainWindow.webContents.send('settings-updated', newSettings)
        tunnel.applySettings()
    })
  } catch (err) {
    dbg(`[window] ❌ Erreur initialisation Cluster: ${err.message}`)
  }
  
  // Liaison Tunnel -> Companion via événements
  tunnel.on('ready', () => companion.updateTunnelStatus(true))
  tunnel.on('lost', () => companion.updateTunnelStatus(false))

  gps.on('location-changed', ({ lat, lon, name }) => {
    companion.broadcastLocation(lat, lon, name)
    companion.confirmLocationApplied(lat, lon, name)
  })

  gps.on('log', (msg) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'server-log', state: 'new', data: msg })
  })

  // --- GESTION DES MODES DE FONCTIONNEMENT ---
  ipcMain.removeHandler('save-settings') // On remplace le handler par défaut
  ipcMain.handle('save-settings', async (event, newSettings) => {
    const oldMode = settings.get('operationMode')
    settings.save(newSettings)
    
    // Basculement à chaud du serveur compagnon
    if (newSettings.operationMode === 'autonomous' && oldMode !== 'autonomous') {
      companion.stop()
    } else if (newSettings.operationMode !== 'autonomous' && oldMode === 'autonomous') {
      companion.start(newSettings.companionPort || settings.get('companionPort'))
    }
    
    tunnel.applySettings()
    event.sender.send('settings-updated', settings.get())
    return { success: true }
  })

  // --- AUTOMATISATION : Re-appliquer la position dès que le tunnel est prêt ---
  tunnel.on('ready', (conn) => {
    if (gps.lastCoords) {
      const { lat, lon, name } = gps.lastCoords
      dbg(`[window] 🔄 Tunnel prêt (${conn.type}). Ré-application automatique de la position en attente : ${lat}, ${lon}`)
      gps.setLocation(lat, lon, name, true)
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

  companion.on('iphone-ip-detected', (ip) => {
    const current = settings.get()
    if (current.wifiIp === ip) return // Évite la boucle infinie si l'IP n'a pas changé

    dbg(`[window] 📱 iPhone détecté (${ip}). Mise à jour de l'IP WiFi...`)
    settings.save({ ...current, wifiIp: ip })
    
    // On ne redémarre le tunnel que si on n'est pas déjà connecté en USB
    if (tunnel.getConnectionType() !== 'USB') {
      tunnel.applySettings()
    }
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

  companion.on('client-log', (log) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'client-log', state: 'new', data: log })
  })

  // --- DÉMARRAGE DES SERVICES ---
  // Si le cluster est désactivé, on démarre normalement.
  // Sinon, c'est l'élection (via ClusterManager) qui déclenchera le démarrage.
  if (initialSettings.clusterMode === 'off' || !initialSettings.clusterMode) {
    if (clusterManager) clusterManager.role = 'master'
    if (initialSettings.operationMode !== 'autonomous') {
        companion.start(initialSettings.companionPort)
    }
    tunnel.start()
  }
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
