'use strict'

const express = require('express')
const { dbg } = require('../logger')

/**
 * WebBridge - Relais API REST pour le mode Headless.
 */
class WebBridge {
  constructor(orchestrator, simulator, cluster, companion) {
    this.orchestrator = orchestrator
    this.simulator = simulator
    this.cluster = cluster
    this.companion = companion
    this.app = express()
    this.app.use(express.json())
  }

  init(portOrApp = 8080) {
    if (typeof portOrApp !== 'number' && portOrApp !== null) {
      // On attache les routes à une app existante (ex: CompanionServer)
      this.app = portOrApp
      dbg(`[bridge] 🔗 Attachement des routes WebBridge à l'application existante`)
      this._setupRoutes()
    } else {
      // On crée notre propre serveur
      const port = portOrApp || 8080
      dbg(`[bridge] 🌐 Initialisation du pont Web API sur le port ${port}`)
      this._setupRoutes()
      this.app.listen(port, () => {
        dbg(`[web-bridge] 🚀 Dashboard accessible sur http://localhost:${port}`)
      })
    }
  }

  _setupRoutes() {
    const settings = require('../core/services/settings-manager')

    // API de Statut (Polyfill pour window.gps.getStatus)
    this.app.get('/api/status', (req, res) => {
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

        let companionLabel = companionConnected ? 'iPhone prêt' : 'En attente de l\'application client...'
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

        res.json({
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
        })
      } catch (e) {
        res.status(500).json({ error: e.message })
      }
    })

    // Commandes GPS
    this.app.post('/api/location/set', async (req, res) => {
      const { lat, lon, name } = req.body
      const result = await this.simulator.setLocation(lat, lon, name)
      res.json(result)
    })

    this.app.post('/api/location/clear', async (req, res) => {
      const result = await this.simulator.clearLocation()
      res.json(result)
    })

    // Settings
    const settings = require('../core/services/settings-manager')
    this.app.get('/api/settings', (req, res) => res.json(settings.get()))
    this.app.post('/api/settings', (req, res) => {
      settings.save(req.body)
      this.orchestrator.applySettings()
      res.json({ success: true })
    })

    // Cluster API (nécessaire pour la communication inter-serveurs)
    this.app.get('/api/cluster/status', (req, res) => res.json(this.cluster.getStatus()))
    this.app.get('/api/cluster/ping', (req, res) => res.json(this.cluster.getStatus()))
    this.app.post('/api/cluster/sync', (req, res) => {
      this.simulator.setLocation(req.body.lat, req.body.lon, req.body.name, true)
      res.json({ success: true })
    })

    // Diagnostics
    this.app.get('/api/diagnostic/pmd3-devices', async (req, res) => {
      const driver = this.orchestrator.drivers['pymobiledevice']
      res.json(driver ? await driver.listDevices() : [])
    })

    this.app.post('/api/diagnostic/restart-tunnel', async (req, res) => {
      await this.orchestrator.forceRefresh()
      res.json({ success: true })
    })

    this.app.get('/api/diagnostic/interfaces', (req, res) => {
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
      res.json(results)
    })

    this.app.get('/api/diagnostic/qr', async (req, res) => {
      res.json(await this.companion.getCompanionQr())
    })

    this.app.get('/api/diagnostic/plists', async (req, res) => {
      // Pour l'instant on mocke ou on délègue si implémenté dans un service
      res.json({ plists: [], hasSelfIdentity: false })
    })

    // Serveur de fichiers statiques (Dashboard Web)
    const path = require('path')
    const { getAppRoot } = require('../platform/PathResolver')
    const distPath = path.join(getAppRoot(), 'server', 'dist-web')
    
    this.app.use(express.static(distPath))
    this.app.use('/renderer-v2', express.static(path.join(distPath, 'renderer-v2')))
    
    // Fallback pour le routage React
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'renderer-v2', 'index.html'))
    })
  }
}

module.exports = WebBridge
