'use strict'

const { ipcMain } = require('electron')
const { dbg } = require('../logger')

/**
 * RegistryBridge - Relais IPC pour Electron.
 */
class RegistryBridge {
  constructor(orchestrator, simulator, cluster, companion) {
    this.orchestrator = orchestrator
    this.simulator = simulator
    this.cluster = cluster
    this.companion = companion
    this.init() // On initialise immédiatement pour éviter les race conditions
  }

  init() {
    dbg('[bridge] 🔌 Initialisation du pont IPC Electron')

    // System
    ipcMain.handle('get-status', () => {
      try {
        return {
          tunnel: {
            status: this.orchestrator.activeConnection ? 'ready' : (this.orchestrator.isStarting() ? 'scanning' : 'idle'),
            label: this.orchestrator.activeConnection ? `Connecté (${this.orchestrator.activeConnection.driver})` : 'Recherche...',
            type: this.orchestrator.activeConnection?.type,
            driver: this.orchestrator.activeDriverId,
            device: {
              type: this.orchestrator.activeConnection?.type === 'MANUAL' ? 'Manual Tunnel' : 'iPhone',
              version: 'iOS 17+',
              ip: this.orchestrator.activeConnection?.address
            }
          },
          companion: {
            status: this.companion.hasActiveClients() ? 'ready' : 'idle',
            label: this.companion.hasActiveClients() ? 'iPhone Connecté' : 'Attente App Mobile...',
            ip: this.companion.getLocalIp()
          }
        }
      } catch (e) {
        dbg(`[bridge] ❌ Error in get-status: ${e.message}`)
        return { error: e.message }
      }
    })

    // GPS
    ipcMain.handle('set-location', async (e, { lat, lon, name }) => {
      try {
        return await this.simulator.setLocation(lat, lon, name)
      } catch (e) {
        dbg(`[bridge] ❌ Error in set-location: ${e.message}`)
        return { success: false, error: e.message }
      }
    })

    ipcMain.handle('clear-location', async () => {
      try {
        return await this.simulator.clearLocation()
      } catch (e) {
        dbg(`[bridge] ❌ Error in clear-location: ${e.message}`)
        return { success: false, error: e.message }
      }
    })

    // Diagnostic / Maintenance
    ipcMain.handle('restart-tunnel', async () => {
      try {
        await this.orchestrator.forceRefresh()
        return { success: true }
      } catch (e) {
        dbg(`[bridge] ❌ Error in restart-tunnel: ${e.message}`)
        return { success: false, error: e.message }
      }
    })

    ipcMain.handle('list-pmd3-devices', async () => {
      try {
        const driver = this.orchestrator.drivers['pymobiledevice']
        return driver ? await driver.listDevices() : []
      } catch (e) {
        dbg(`[bridge] ❌ Error in list-pmd3-devices: ${e.message}`)
        return []
      }
    })

    // Settings
    const settings = require('../core/services/settings-manager')
    ipcMain.handle('get-settings', () => {
      try {
        return settings.get()
      } catch (e) {
        dbg(`[bridge] ❌ Error in get-settings: ${e.message}`)
        return {}
      }
    })

    ipcMain.handle('save-settings', async (e, newSettings) => {
      try {
        settings.save(newSettings)
        this.orchestrator.applySettings()
        return true
      } catch (e) {
        dbg(`[bridge] ❌ Error in save-settings: ${e.message}`)
        return false
      }
    })

    // Cluster
    ipcMain.handle('get-cluster-status', () => {
      try {
        return this.cluster.getStatus()
      } catch (e) {
        dbg(`[bridge] ❌ Error in get-cluster-status: ${e.message}`)
        return {}
      }
    })

    ipcMain.handle('takeover-cluster', async () => {
      try {
        await this.cluster.takeover()
        return { success: true }
      } catch (e) {
        dbg(`[bridge] ❌ Error in takeover-cluster: ${e.message}`)
        return { success: false, error: e.message }
      }
    })

    ipcMain.handle('release-cluster', async () => {
      try {
        await this.cluster.release()
        return { success: true }
      } catch (e) {
        dbg(`[bridge] ❌ Error in release-cluster: ${e.message}`)
        return { success: false, error: e.message }
      }
    })
  }
}

module.exports = RegistryBridge
