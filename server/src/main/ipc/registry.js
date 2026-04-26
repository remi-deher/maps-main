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
    connectionType: tunnel.getConnectionType()
  }))

  ipcMain.handle('restart-tunnel', () => tunnel.forceRefresh())

  // ─── GPS Simulation ────────────────────────────────────────────────────────
  
  ipcMain.handle('set-location', async (_event, { lat, lon, name }) => {
    try {
      const result = await gps.setLocation(lat, lon, name)
      if (result.success) {
        companion.broadcastLocation(lat, lon, name)
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

  ipcMain.handle('play-route', async (_event, { endLat, endLon, speed }) => {
    try {
      const routeGenerator = require('../services/gps/route-generator')
      const gpsBridge = require('../services/gps/gps-bridge')
      
      const start = companion.status.lastVerifiedLocation || companion.status.lastInjectedLocation
      if (!start) throw new Error('Position de départ inconnue')

      const gpxPath = routeGenerator.generateOrthodromicGpx(
        { lat: start.lat, lon: start.lon },
        { lat: endLat, lon: endLon },
        speed || 5
      )

      const result = await gpsBridge.playGpx(gpxPath)
      
      if (result.success) {
        companion.status.state = 'moving'
        companion._broadcast({ type: 'STATUS', data: companion.status })
      }
      
      return result
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

  ipcMain.handle('play-custom-gpx', async (_event, { gpxContent, speed }) => {
    try {
      const routeGenerator = require('../services/gps/route-generator')
      const gpsBridge = require('../services/gps/gps-bridge')
      
      const gpxPath = routeGenerator.processExternalGpx(gpxContent, speed)
      const result = await gpsBridge.playGpx(gpxPath)
      
      if (result.success) {
        companion.status.state = 'moving'
        companion._broadcast({ type: 'STATUS', data: companion.status })
      }
      
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('play-osrm-route', async (_event, { endLat, endLon, profile, speed }) => {
    try {
      const routeGenerator = require('../services/gps/route-generator')
      const gpsBridge = require('../services/gps/gps-bridge')
      
      const start = companion.status.lastVerifiedLocation || companion.status.lastInjectedLocation
      if (!start) throw new Error('Position de départ inconnue')

      const gpxPath = await routeGenerator.generateOsrmRoute(
        { lat: start.lat, lon: start.lon },
        { lat: endLat, lon: endLon },
        profile || 'driving',
        speed
      )

      const result = await gpsBridge.playGpx(gpxPath)
      
      if (result.success) {
        companion.status.state = 'moving'
        companion._broadcast({ type: 'STATUS', data: companion.status })
      }
      
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('play-sequence', async (_event, legs) => {
    try {
      const routeGenerator = require('../services/gps/route-generator')
      const gpsBridge = require('../services/gps/gps-bridge')
      
      const gpxPath = await routeGenerator.generateMultimodalGpx(legs)
      const result = await gpsBridge.playGpx(gpxPath)
      
      if (result.success) {
        companion.status.state = 'moving'
        companion._broadcast({ type: 'STATUS', data: companion.status })
      }
      
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ─── Settings ──────────────────────────────────────────────────────────────
  
  ipcMain.handle('get-settings', () => settings.get())

  ipcMain.handle('save-settings', (_event, newSettings) => {
    settings.save(newSettings)
    // Synchronisation immédiate avec le tunnel manager
    tunnel.setWifiIpOverride(newSettings.wifiIp || null, newSettings.wifiPort || null)
    if (newSettings.connectionMode) {
      tunnel.applyConnectionMode(newSettings.connectionMode)
    }
    if (newSettings.companionPort) {
      companion.start(newSettings.companionPort)
    }
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

  ipcMain.handle('get-network-interfaces', () => {
    return companion.getNetworkInterfaces ? companion.getNetworkInterfaces() : []
  })

  ipcMain.handle('open-logs', async () => {
    await shell.openPath(app.getPath('logs'))
  })

  ipcMain.handle('import-plist', async (_event, { name, content }) => {
    const fs = require('fs')
    const path = require('path')
    try {
      const projectRoot = path.join(app.getAppPath(), '..')
      if (name === 'selfIdentity.plist') {
        fs.writeFileSync(path.join(projectRoot, 'selfIdentity.plist'), content)
      } else {
        let lockdownDir = 'C:\\ProgramData\\Apple\\Lockdown'
        if (process.platform === 'linux') {
          lockdownDir = '/var/lib/lockdown'
        }
        if (!fs.existsSync(lockdownDir)) fs.mkdirSync(lockdownDir, { recursive: true })
        fs.writeFileSync(path.join(lockdownDir, name), content)
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
      const hasSelfIdentity = fs.existsSync(path.join(projectRoot, 'selfIdentity.plist'))
      
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
