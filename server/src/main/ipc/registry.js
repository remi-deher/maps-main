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

  ipcMain.handle('get-network-interfaces', () => getNetworkInterfaces())

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

  ipcMain.handle('open-logs', async () => {
    await shell.openPath(app.getPath('logs'))
  })
}

module.exports = { registerIpcHandlers }
