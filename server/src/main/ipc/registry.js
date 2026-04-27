'use strict'

const { ipcMain, app, shell } = require('electron')
const settings = require('../services/settings-manager')
const QRCode = require('qrcode')
const { getNetworkInterfaces } = require('../utils/network')

/**
 * Registre central des IPC Handlers.
 * Fait le lien entre le Front-end (renderer) et les Services (main).
 */
function registerIpcHandlers(tunnel, gps, companion) {
  
  // ─── Tunnel & Status ───────────────────────────────────────────────────────
  
  ipcMain.handle('get-status', () => ({
    tunnelReady: !!tunnel.getRsdAddress(),
    rsdAddress:  tunnel.getRsdAddress(),
    rsdPort:     tunnel.getRsdPort(),
    connectionType: tunnel.getConnectionType(),
    operationMode: settings.get('operationMode')
  }))

  ipcMain.handle('restart-tunnel', () => tunnel.forceRefresh())

  // ─── GPS Simulation ────────────────────────────────────────────────────────
  
  ipcMain.handle('set-location', async (_event, { lat, lon, name }) => {
    try {
      if (!tunnel.getRsdAddress()) throw new Error('Tunnel non prêt')
      const result = await gps.setLocation(lat, lon, name)
      if (result.success) {
        companion.status.lastInjectedLocation = { lat, lon, name }
        companion._broadcast('STATUS', companion.status)
      }
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('clear-location', async () => {
    try {
      await gps.clearLocation()
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('play-route', async (_event, data) => {
    try {
      if (!tunnel.getRsdAddress()) throw new Error('Tunnel non prêt')
      companion._handleRouteMessage(null, { type: 'PLAY_ROUTE', data })
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('dialog:openGpx', async () => {
    const { dialog } = require('electron')
    const fs = require('fs').promises
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'GPX', extensions: ['gpx'] }]
    })
    
    if (!res.canceled && res.filePaths.length > 0) {
      const content = await fs.readFile(res.filePaths[0], 'utf8')
      return { success: true, content, path: res.filePaths[0] }
    }
    return { success: false }
  })

  ipcMain.handle('play-custom-gpx', async (_event, data) => {
    try {
      if (!tunnel.getRsdAddress()) throw new Error('Tunnel non prêt')
      companion._handleRouteMessage(null, { type: 'PLAY_CUSTOM_GPX', data })
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('play-osrm-route', async (_event, data) => {
    try {
      if (!tunnel.getRsdAddress()) throw new Error('Tunnel non prêt')
      companion._handleRouteMessage(null, { type: 'PLAY_OSRM_ROUTE', data })
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('play-sequence', async (_event, legs) => {
    try {
      if (!tunnel.getRsdAddress()) throw new Error('Tunnel non prêt')
      companion._handleRouteMessage(null, { type: 'PLAY_SEQUENCE', data: { legs } })
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ─── Settings ──────────────────────────────────────────────────────────────
  
  ipcMain.handle('get-settings', () => settings.get())

  ipcMain.handle('get-network-interfaces', async () => {
    const os = require('os')
    const interfaces = os.networkInterfaces()
    const results = []
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          results.push({
            name,
            address: iface.address
          })
        }
      }
    }
    return results
  })

  ipcMain.handle('save-settings', async (event, newSettings) => {
    settings.save(newSettings)
    // Synchronisation complète avec l'orchestrateur de tunnels
    tunnel.applySettings(settings.get())
    
    if (newSettings.companionPort) {
      companion.start(newSettings.companionPort)
    }
    
    // Notifier le frontend que les réglages ont changé (pour rafraîchir le QR Code etc.)
    event.sender.send('settings-updated', settings.get())
    
    return { success: true }
  })

  // ─── Favorites Management ──────────────────────────────────────────────────
  
  ipcMain.handle('add-favorite', (_event, fav) => {
    companion.addFavorite(fav)
    return { success: true }
  })

  ipcMain.handle('remove-favorite', (_event, { lat, lon }) => {
    companion.removeFavorite(lat, lon)
    return { success: true }
  })

  ipcMain.handle('rename-favorite', (_event, { lat, lon, newName }) => {
    companion.renameFavorite(lat, lon, newName)
    return { success: true }
  })

  // ─── Système ───────────────────────────────────────────────────────────────
  
  ipcMain.handle('get-companion-qr', async () => {
    try {
      const info = companion.getConnectionInfo()
      const qrData = info.url // Format: ws://ip:port
      const dataUrl = await QRCode.toDataURL(qrData, {
        margin: 2,
        scale: 8,
        color: {
          dark: '#2d3748',
          light: '#ffffff'
        }
      })
      return { success: true, dataUrl, ...info }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })



  ipcMain.handle('open-logs', async () => {
    await shell.openPath(app.getPath('logs'))
  })

  ipcMain.handle('import-plist', async (_event, { name, content }) => {
    const fs = require('fs')
    const path = require('path')
    try {
      const projectRoot = path.join(app.getAppPath(), '..')
      const certsDir = path.join(projectRoot, 'certs')
      
      if (name === 'selfIdentity.plist') {
        // On enregistre dans certs/ si le dossier existe (Docker), sinon à la racine
        const targetDir = fs.existsSync(certsDir) ? certsDir : projectRoot
        fs.writeFileSync(path.join(targetDir, 'selfIdentity.plist'), content)
      } else {
        let lockdownDir = 'C:\\ProgramData\\Apple\\Lockdown'
        if (process.platform === 'linux') {
          lockdownDir = '/var/lib/lockdown'
        }
        if (!fs.existsSync(lockdownDir)) fs.mkdirSync(lockdownDir, { recursive: true })
        fs.writeFileSync(path.join(lockdownDir, name), content)
      }

      // --- DIFFUSION CLUSTER ---
      const clusterManager = require('../services/cluster-manager')
      if (clusterManager.role === 'master') {
        clusterManager.broadcastPlist(name, content)
      }

      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('list-plists', async () => {
    const fs = require('fs')
    const path = require('path')
    try {
      let lockdownDir = 'C:\\ProgramData\\Apple\\Lockdown'
      if (process.platform === 'linux') lockdownDir = '/var/lib/lockdown'
      
      const files = fs.existsSync(lockdownDir) ? fs.readdirSync(lockdownDir).filter(f => f.endsWith('.plist')) : []
      const projectRoot = path.join(app.getAppPath(), '..')
      const certsDir = path.join(projectRoot, 'certs')
      
      const hasSelfIdentity = fs.existsSync(path.join(projectRoot, 'selfIdentity.plist')) || 
                             (fs.existsSync(certsDir) && fs.existsSync(path.join(certsDir, 'selfIdentity.plist')))
      
      return { success: true, plists: files, hasSelfIdentity }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('delete-plist', async (_event, name) => {
    const fs = require('fs')
    const path = require('path')
    try {
      const projectRoot = path.join(app.getAppPath(), '..')
      if (name === 'selfIdentity.plist') {
        const p = path.join(projectRoot, 'selfIdentity.plist')
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } else {
        let lockdownDir = 'C:\\ProgramData\\Apple\\Lockdown'
        if (process.platform === 'linux') lockdownDir = '/var/lib/lockdown'
        const p = path.join(lockdownDir, name)
        if (fs.existsSync(p)) fs.unlinkSync(p)
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
}

module.exports = { registerIpcHandlers }
