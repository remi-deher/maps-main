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
        const mode = settings.get('operationMode') || 'hybrid'
        const tunnelConnected = !!this.orchestrator.activeConnection
        const companionConnected = this.companion.hasActiveClients()
        const simulationActive = this.simulator.isActive()
        
        let tunnelLabel = tunnelConnected ? 'iPhone détecté' : 'iPhone non détecté (Recherche...)'
        let tunnelStatus = this.orchestrator.isStarting() ? 'scanning' : 'idle'
        
        if (tunnelConnected) {
          tunnelStatus = 'ready'
          if (simulationActive) {
            tunnelLabel += ' - Simulation en cours'
          } else {
            tunnelLabel += ' - Prêt à envoyer une localisation'
          }
        }

        let companionLabel = companionConnected ? 'iPhone Connecté (App Mobile)' : 'Attente App Mobile...'
        let companionStatus = companionConnected ? 'ready' : 'idle'

        // Ajustement selon le mode
        if (mode === 'client-server' && !companionConnected) {
          tunnelLabel = 'Attente de l\'application mobile (Localisation bloquée)'
          tunnelStatus = 'blocked'
          companionLabel = '⚠️ Application mobile requise'
          companionStatus = 'warning'
        } else if (mode === 'autonomous') {
          companionLabel = 'Mode Autonome (Désactivé)'
          companionStatus = 'disabled'
        } else if (mode === 'hybrid' && !companionConnected) {
          companionLabel = 'Mode Hybride (App mobile optionnelle)'
        }

        return {
          tunnel: {
            status: tunnelStatus,
            label: tunnelLabel,
            type: this.orchestrator.activeConnection?.type,
            driver: this.orchestrator.activeDriverId,
            device: {
              type: this.orchestrator.activeConnection?.type === 'MANUAL' ? 'Manual Tunnel' : 'iPhone',
              version: 'iOS 17+',
              ip: this.orchestrator.activeConnection?.address
            }
          },
          companion: {
            status: companionStatus,
            label: companionLabel,
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

    // Diagnostics & Network
    ipcMain.handle('get-network-interfaces', () => {
      try {
        const os = require('os')
        const interfaces = os.networkInterfaces()
        const results = []
        for (const name of Object.keys(interfaces)) {
          for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
              results.push({ name, address: iface.address })
            }
          }
        }
        return results
      } catch (e) {
        dbg(`[bridge] ❌ Error in get-network-interfaces: ${e.message}`)
        return []
      }
    })

    ipcMain.handle('get-companion-qr', async () => {
      try {
        return await this.companion.getCompanionQr()
      } catch (e) {
        dbg(`[bridge] ❌ Error in get-companion-qr: ${e.message}`)
        return { error: e.message }
      }
    })

    ipcMain.handle('list-plists', async () => {
      try {
        const fs = require('fs')
        const { getResourcePath } = require('../platform/PathResolver')
        const resourcesDir = getResourcePath()
        
        const files = fs.readdirSync(resourcesDir)
        const plists = files.filter(f => f.endsWith('.plist'))
        const hasSelfIdentity = files.includes('selfIdentity.plist')
        
        return { plists, hasSelfIdentity }
      } catch (e) {
        dbg(`[bridge] ❌ Error in list-plists: ${e.message}`)
        return { plists: [], hasSelfIdentity: false }
      }
    })

    ipcMain.handle('run-diag', async (e, type) => {
      try {
        if (type === 'pmd3-devices') {
          const driver = this.orchestrator.drivers['pymobiledevice']
          const devices = driver ? await driver.listDevices() : []
          return { output: JSON.stringify(devices, null, 2) }
        }
        return { output: `Scan ${type} non supporté en mode direct` }
      } catch (e) {
        return { output: `Erreur diag: ${e.message}` }
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
