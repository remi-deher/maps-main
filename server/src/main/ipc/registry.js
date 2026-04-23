'use strict'

const { ipcMain, app, shell } = require('electron')
const settings = require('../services/settings-manager')
const QRCode = require('qrcode')

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

  // ─── GPS Simulation ────────────────────────────────────────────────────────
  
  ipcMain.handle('set-location', async (_event, { lat, lon, name }) => {
    try {
      return await gps.setLocation(lat, lon, name)
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

  // ─── Système ───────────────────────────────────────────────────────────────
  
  ipcMain.handle('get-companion-qr', async () => {
    try {
      const info = companion.getConnectionInfo()
      const qrData = JSON.stringify({ ip: info.ip, port: info.port })
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
