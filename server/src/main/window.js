'use strict'

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ UNHANDLED REJECTION:', reason);
});

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron')
const path = require('path')
const { setWindow, dbg } = require('./logger')
const companionServer = require('./core/services/companion-server')
const ElectronTarget = require('./targets/ElectronTarget')

let mainWindow
let target
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

app.whenReady().then(async () => {
  const orchestrator = require('./core/services/TunnelManager')
  const companion = new companionServer(orchestrator)
  
  target = new ElectronTarget(companion)
  
  createWindow()
  createTray()
  
  await target.start()

  // Liaisons UI supplémentaires si besoin
  target.simulator.on('log', (msg) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'server-log', state: 'new', data: msg })
  })

  companion.on('client-log', (log) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'client-log', state: 'new', data: log })
  })

  companion.on('favorites-updated', (favs) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'favorites', state: 'updated', data: favs })
  })

  companion.on('history-updated', (history) => {
    if (mainWindow) mainWindow.webContents.send('status-update', { service: 'history', state: 'updated', data: history })
  })
})

app.on('before-quit', () => {
  isQuitting = true
  if (tray) tray.destroy()
  if (target) target.stop()
})

app.on('window-all-closed', () => {
  // Sur Windows, on ne quitte pas si on a le tray
  if (process.platform !== 'darwin' && !isQuitting) {
    // On ne fait rien, la fenêtre est juste cachée
  } else {
    if (target) target.stop()
    app.quit()
  }
})

module.exports = { createWindow }
