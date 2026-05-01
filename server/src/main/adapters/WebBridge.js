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
          companionLabel = 'Mode Autonome (Bloqué)'
          companionStatus = 'disabled'
          if (companionConnected) {
             companionLabel = '⚠️ iPhone connecté mais ignoré (Autonome)'
             companionStatus = 'warning'
          }
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

    // Trajets & Séquences (REST direct)
    this.app.post('/api/location/route', async (req, res) => {
      this.companion._handleRouteMessage(null, { type: 'PLAY_ROUTE', data: req.body })
      res.json({ success: true })
    })

    this.app.post('/api/location/osrm', async (req, res) => {
      this.companion._handleRouteMessage(null, { type: 'PLAY_OSRM_ROUTE', data: req.body })
      res.json({ success: true })
    })

    this.app.post('/api/location/sequence', async (req, res) => {
      this.companion._handleRouteMessage(null, { type: 'PLAY_SEQUENCE', data: { legs: req.body } })
      res.json({ success: true })
    })

    // Pont IPC Générique (pour compatibilité avec window.gps.invoke du dashboard)
    this.app.post('/api/ipc/:action', async (req, res) => {
      const { action } = req.params
      const data = req.body
      
      dbg(`[web-bridge] ⚡ Appel IPC: ${action}`)

      try {
        switch (action) {
          case 'get-status':
            // On peut réutiliser la logique existante ou déléguer
            return res.redirect(307, '/api/status')
          case 'set-location':
            return res.json(await this.simulator.setLocation(data.lat, data.lon, data.name))
          case 'clear-location':
            return res.json(await this.simulator.clearLocation())
          case 'play-route':
            this.companion._handleRouteMessage(null, { type: 'PLAY_ROUTE', data })
            return res.json({ success: true })
          case 'play-osrm-route':
            this.companion._handleRouteMessage(null, { type: 'PLAY_OSRM_ROUTE', data })
            return res.json({ success: true })
          case 'play-sequence':
            this.companion._handleRouteMessage(null, { type: 'PLAY_SEQUENCE', data: { legs: data } })
            return res.json({ success: true })
          case 'get-settings':
            return res.json(settings.get())
          case 'save-settings':
            settings.save(data)
            this.orchestrator.applySettings()
            return res.json({ success: true })
          case 'get-companion-qr':
            return res.json(await this.companion.getCompanionQr())
          case 'get-network-interfaces':
            const os = require('os')
            const interfaces = os.networkInterfaces()
            const results = []
            for (const name of Object.keys(interfaces)) {
              for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) results.push({ name, address: iface.address })
              }
            }
            return res.json(results)
          default:
            dbg(`[web-bridge] ⚠️ IPC non géré: ${action}`)
            res.status(404).json({ success: false, error: `IPC ${action} non supporté` })
        }
      } catch (e) {
        res.status(500).json({ success: false, error: e.message })
      }
    })

    // Settings
    this.app.get('/api/settings', (req, res) => res.json(settings.get()))
    this.app.post('/api/settings', (req, res) => {
      settings.save(req.body)
      if (req.body.logLevel) {
        const { setLogLevel } = require('../logger')
        setLogLevel(req.body.logLevel)
      }
      this.orchestrator.applySettings()
      this.simulator.refreshSettings()
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
    const distPath = path.join(getAppRoot(), 'dist-web')
    
    this.app.use(express.static(distPath))
    this.app.use('/renderer-v2', express.static(path.join(distPath, 'renderer-v2')))
    
    // Polyfill web-api.js pour injecter window.gps en mode Web sans avoir à recompiler le Dashboard
    this.app.get('/web-api.js', (req, res) => {
      res.setHeader('Content-Type', 'application/javascript')
      res.send(`
        console.log('[web-api] 🛠️ Injection du polyfill GPS (Socket.io Edition)');
        
        // Chargement dynamique de Socket.io client
        const script = document.createElement('script');
        script.src = '/socket.io/socket.io.js';
        document.head.appendChild(script);

        const statusCallbacks = new Set();
        const settingsCallbacks = new Set();
        let socket = null;

        script.onload = () => {
          console.log('[web-api] 🔌 Socket.io client chargé');
          socket = io();
          socket.on('status-update', (data) => {
            statusCallbacks.forEach(cb => cb(data));
          });
          socket.on('debug-log', (msg) => {
            // On transforme les logs de debug en événements de statut pour le Dashboard
            statusCallbacks.forEach(cb => cb({ service: 'server-log', data: msg }));
          });
          socket.on('STATUS', (data) => {
            // Compatibilité avec le format STATUS global
            statusCallbacks.forEach(cb => cb({ service: 'tunneld', state: data.state, message: 'Update', ...data }));
          });
        };

        window.gps = {
          isElectron: false,
          getStatus: () => fetch('/api/status').then(r => r.json()),
          getSettings: () => fetch('/api/settings').then(r => r.json()),
          saveSettings: (s) => fetch('/api/settings', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s) }).then(r => r.json()),
          setLocation: (lat, lon, name) => fetch('/api/location/set', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({lat, lon, name}) }).then(r => r.json()),
          clearLocation: () => fetch('/api/location/clear', { method: 'POST' }).then(r => r.json()),
          listPmd3Devices: () => fetch('/api/diagnostic/pmd3-devices').then(r => r.json()).catch(() => []),
          restartTunnel: () => fetch('/api/diagnostic/restart-tunnel', { method: 'POST' }).then(r => r.json()),
          getNetworkInterfaces: () => fetch('/api/diagnostic/interfaces').then(r => r.json()).catch(() => []),
          getCompanionQr: () => fetch('/api/diagnostic/qr').then(r => r.json()),
          listPlists: () => fetch('/api/diagnostic/plists').then(r => r.json()).catch(() => ({ plists: [] })),
          
          onStatus: (cb) => { 
            statusCallbacks.add(cb); 
            return () => statusCallbacks.delete(cb); 
          },
          onSettingsUpdated: (cb) => { 
            settingsCallbacks.add(cb); 
            return () => settingsCallbacks.delete(cb); 
          },
          onEvent: (name, cb) => { return () => {} },
          openGpxDialog: () => Promise.resolve({ success: false, error: 'Non supporté en mode Web' }),
          playCustomGpx: () => Promise.resolve({ success: false })
        };
      `)
    })
    
    // Fallback pour le routage React (doit être la DERNIÈRE route)
    this.app.use((req, res) => {
      res.sendFile(path.join(distPath, 'renderer-v2', 'index.html'))
    })
  }
}

module.exports = WebBridge
