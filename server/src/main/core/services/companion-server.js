'use strict'

const { Server } = require('socket.io')
const os = require('os')
const http = require('http')
const fs = require('fs')
const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const QRCode = require('qrcode')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../../logger')
const favoritesManager = require('./favorites-manager')
const settings = require('./settings-manager')
const routeGenerator = require('./gps/route-generator')
const gpsBridge = require('./gps/gps-bridge')
const clusterManager = require('./cluster-manager')
const { getAppRoot } = require('../../platform/PathResolver')

let app = null;
try {
  const electron = require('electron');
  app = electron.app;
} catch (e) {}

/**
 * CompanionServer - Gere la communication via Socket.io avec l'application iOS
 */
class CompanionServer extends EventEmitter {
  constructor(tunnelManager) {
    super()
    this.tunnel = tunnelManager
    this.io = null
    this.httpServer = null
    this.app = express()
    this.port = null
    this.status = {}
    this.lastDriftRelance = 0
    this._consecutiveValidationFailures = 0
    this._lastAutoReinjectionTime = 0
    
    this.app.use(bodyParser.json())
    this._setupRoutes()
    this._refreshStatus()

    favoritesManager.on('favorites-updated', (favs) => {
      this.status.favorites = favs
      this._broadcast('STATUS_UPDATE', { favorites: favs })
      this.emit('favorites-updated', favs)
    })

    favoritesManager.on('history-updated', (history) => {
      this.status.recentHistory = history
      this._broadcast('STATUS_UPDATE', { recentHistory: history })
      this.emit('history-updated', history)
    })

    if (this.tunnel) {
      this.tunnel.on('ready', () => {
        this._refreshStatus()
        this._broadcast('STATUS', this.status)
      })
      this.tunnel.on('lost', () => {
        this._refreshStatus()
        this._broadcast('STATUS', this.status)
      })
    }

    // Enregistrement comme abonné aux logs pour redirection vers le Dashboard
    const loggerModule = require('../../logger')
    if (loggerModule._headlessEventSubscribers) {
      loggerModule._headlessEventSubscribers.push({
        onDebug: (msg) => this._broadcast('debug-log', msg),
        onStatus: (payload) => this._broadcast('status-update', payload)
      })
    }
  }

  _refreshStatus() {
    const rsdReady = !!this.tunnel?.getRsdAddress();
    const isStarting = this.tunnel?.isStarting ? this.tunnel.isStarting() : false;
    const simActive = !!(rsdReady && this.status?.lastVerifiedLocation);

    const manualStates = ['moving']
    const currentState = this.status?.state
    
    let computedState = 'idle';
    if (simActive) computedState = 'running';
    else if (rsdReady) computedState = 'ready';
    else if (isStarting) computedState = 'starting';
    
    const finalState = (manualStates.includes(currentState) && rsdReady)
      ? currentState
      : computedState;
    
    this.status = {
      state: finalState,
      tunnelActive: rsdReady,
      rsdAddress: this.tunnel?.getRsdAddress() || null,
      rsdPort: this.tunnel?.getRsdPort() || null,
      connectionType: this.tunnel?.getConnectionType() || null,
      deviceInfo: this.tunnel?.getDeviceInfo() || null,
      maintainActive: this.status?.maintainActive || false,
      lastHeartbeat: this.status?.lastHeartbeat || null,
      lastInjectedLocation: this.status?.lastInjectedLocation || null,
      lastVerifiedLocation: this.status?.lastVerifiedLocation || null,
      lastActiveLocation: settings.get('lastActiveLocation'),
      usbDriver: settings.get('usbDriver'),
      wifiDriver: settings.get('wifiDriver'),
      fallbackEnabled: settings.get('fallbackEnabled'),
      favorites: favoritesManager.getFavorites(),
      recentHistory: favoritesManager.getHistory(),
      envInfo: {
        os: process.platform,
        isDocker: fs.existsSync('/.dockerenv'),
        mode: process.versions.electron ? 'Electron' : 'Headless',
        version: settings.get('version') || '2.1.0'
      },
      cluster: {
        role: clusterManager.role,
        peers: settings.get('clusterNodes') || []
      }
    }
  }

  confirmLocationApplied(lat, lon, name) {
    this.status.lastVerifiedLocation = { lat, lon, name, timestamp: Date.now() };
    this._refreshStatus();
    this._broadcast('STATUS', this.status);
  }

  addFavorite(fav) {
    favoritesManager.addFavorite(fav)
  }

  removeFavorite(lat, lon) {
    favoritesManager.removeFavorite(lat, lon)
  }

  renameFavorite(lat, lon, newName) {
    favoritesManager.renameFavorite(lat, lon, newName)
  }

  _setupRoutes() {
    this.app.post('/api/enroll', (req, res) => {
      const { udid, selfIdentity, deviceRecord } = req.body
      if (!udid || !selfIdentity || !deviceRecord) return res.status(400).json({ error: 'Données manquantes' })
      try {
        const projectRoot = getAppRoot()
        
        const decodeAndWrite = (filePath, content) => {
          const buffer = content.includes('base64,') ? Buffer.from(content.split(',')[1], 'base64') : 
                        (content.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(content) ? Buffer.from(content, 'base64') : content)
          fs.writeFileSync(filePath, buffer)
        }

        decodeAndWrite(path.join(projectRoot, 'selfIdentity.plist'), selfIdentity)
        
        let lockdownDir = 'C:\\ProgramData\\Apple\\Lockdown'
        if (process.platform === 'linux') {
          lockdownDir = '/var/lib/lockdown'
          if (!fs.existsSync(lockdownDir)) fs.mkdirSync(lockdownDir, { recursive: true })
        }
        const devicePath = path.join(lockdownDir, `${udid}.plist`)
        decodeAndWrite(devicePath, deviceRecord)
        
        res.json({ success: true, message: 'Enrôlement réussi' })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    this.app.get('/api/status', (req, res) => {
      res.json(this.status)
    })

    this.app.post('/api/relance', (req, res) => {
      const { lat, lon, name } = req.body
      if (lat === undefined || lon === undefined) return res.status(400).end()
      const now = Date.now()
      if (now - this.lastDriftRelance < 45000) return res.json({ ignored: 'cooldown' })
      this.lastDriftRelance = now
      this.emit('request-location', { lat, lon, name, force: true })
      res.json({ success: true })
    })

    // --- ROUTES CLUSTER ---
    this.app.get('/api/cluster/ping', (req, res) => {
      res.json(clusterManager.getStatus())
    })

    this.app.post('/api/cluster/sync', (req, res) => {
      const { lat, lon, name, mode } = req.body
      dbg(`[cluster] 📥 Synchro reçue du Maître : ${lat}, ${lon}`)
      this.emit('cluster-sync', { lat, lon, name, mode })
      res.json({ success: true })
    })

    this.app.post('/api/cluster/takeover', (req, res) => {
      dbg(`[cluster] 📥 Demande de takeover reçue. Libération du rôle...`)
      clusterManager.release()
      res.json({ success: true })
    })

    this.app.get('/api/cluster/plists', (req, res) => {
      try {
        const plists = []
        const projectRoot = getAppRoot()
        
        // 1. Identité serveur
        const selfPath = path.join(projectRoot, 'selfIdentity.plist')
        if (fs.existsSync(selfPath)) {
          plists.push({ name: 'selfIdentity.plist', content: fs.readFileSync(selfPath).toString('base64') })
        }

        // 2. Records iPhone
        let lockdownDir = process.platform === 'win32' ? 'C:\\ProgramData\\Apple\\Lockdown' : '/var/lib/lockdown'
        if (fs.existsSync(lockdownDir)) {
          const files = fs.readdirSync(lockdownDir).filter(f => f.endsWith('.plist'))
          for (const f of files) {
            plists.push({ name: f, content: fs.readFileSync(path.join(lockdownDir, f)).toString('base64') })
          }
        }
        res.json({ success: true, plists })
      } catch (e) {
        res.status(500).json({ success: false, error: e.message })
      }
    })

    this.app.post('/api/cluster/sync-plist', async (req, res) => {
      const { name, content } = req.body
      dbg(`[cluster] 📥 Réception du certificat ${name} du Maître...`)
      await clusterManager._saveLocalPlist(name, content)
      res.json({ success: true })
    })

    this.app.post('/api/cluster/update-config', (req, res) => {
      const newSettings = req.body
      dbg(`[cluster] 📥 Mise à jour config à distance reçue`)
      settings.save(newSettings)
      this.emit('settings-updated', settings.get())
      res.json({ success: true })
    })
  }

  async getCompanionQr() {
    try {
      const ip = this.getLocalIp()
      const port = this.port || 8080
      const url = `ws://${ip}:${port}`
      const dataUrl = await QRCode.toDataURL(url, {
        margin: 2,
        scale: 8,
        color: { dark: '#2d3748', light: '#ffffff' }
      })
      return { success: true, dataUrl, ip, port, url }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  start(port = 8080) {
    if (this.httpServer) this.stop()

    try {
      this.port = port
      this.httpServer = http.createServer(this.app)
      this.io = new Server(this.httpServer, {
        cors: { origin: "*" }
      })
      
      const ip = this.getLocalIp()
      
      this.httpServer.listen(port, () => {
        dbg(`[companion-server] Serveur (Socket.io) demarre sur ${ip}:${port}`)
        sendStatus('companion', 'info', `Prêt sur ${ip}:${port}`)
      })

      // Middleware de filtrage pour le mode Autonome
      this.io.use((socket, next) => {
        const mode = settings.get('operationMode')
        if (mode === 'autonomous') {
          // On essaie de distinguer le Dashboard de l'iPhone
          // Le Dashboard est sur le même hôte, l'iPhone est externe
          const isLocal = socket.handshake.address === '127.0.0.1' || 
                          socket.handshake.address === '::1' || 
                          socket.handshake.address === '::ffff:127.0.0.1' ||
                          (socket.handshake.headers.origin && socket.handshake.headers.origin.includes(this.port))

          if (!isLocal) {
            // Silence par défaut pour ne pas spammer
            return next(new Error('AUTONOMOUS_MODE_ACTIVE'))
          }
        }
        next()
      })

      this.io.on('connection', (socket) => {
        let clientIp = socket.handshake.address
        if (clientIp.startsWith('::ffff:')) clientIp = clientIp.substring(7)
        
        dbg(`[companion-server] Client connecte : ${socket.id} (${clientIp})`)
        this.emit('iphone-ip-detected', clientIp)
        
        this._refreshStatus()
        socket.emit('STATUS', this.status)

        const actions = [
          'SET_LOCATION', 'PLAY_ROUTE', 'PLAY_SEQUENCE', 'PLAY_OSRM_ROUTE', 
          'PLAY_CUSTOM_GPX', 'ADD_HISTORY', 'ADD_FAVORITE', 'REMOVE_FAVORITE', 
          'RENAME_FAVORITE', 'SAVE_SETTINGS', 'GET_STATUS', 'HEARTBEAT', 'DEBUG_LOG'
        ]

        actions.forEach(event => {
          socket.on(event, (data) => {
            const mode = settings.get('operationMode')
            if (mode === 'autonomous' && event === 'SET_LOCATION') {
              dbg(`[companion-server] ⚠️ Commande SET_LOCATION ignorée (Mode Autonome)`)
              return
            }
            this._handleMessage(socket, { type: event, data })
          })
        });

        socket.on('disconnect', () => {
          dbg(`[companion-server] Client deconnecte : ${socket.id}`)
          this._checkActivity()
        })
      })

    } catch (e) {
      dbg(`[companion-server] Erreur demarrage: ${e.message}`)
    }
  }

  /**
   * Arrête proprement le serveur compagnon
   */
  stop() {
    if (this.io) {
      this.io.close()
      this.io = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
    dbg('[companion-server] Serveur compagnon arrêté.')
  }

  /**
   * Vérifie si au moins un client (iPhone) est connecté
   */
  hasActiveClients() {
    if (!this.io) return false
    return this.io.sockets.sockets.size > 0
  }

  updateTunnelStatus(active) {
    this._refreshStatus()
    this.status.tunnelActive = active
    this._broadcast('STATUS', this.status)
    this._updateFrontend()
  }

  broadcastLocation(lat, lon, name = '') {
    this._broadcast('LOCATION', { lat, lon, name })
  }

  _handleMessage(socket, payload) {
    switch (payload.type) {
      case 'HEARTBEAT': {
        const data = payload.data || {}
        this.status.maintainActive = data.isMaintaining || false
        this.status.lastHeartbeat = Date.now()
        
        // Validation Active (Point 1)
        if (data.latitude && data.longitude) {
          this._validatePosition(data.latitude, data.longitude)
        }

        this._updateFrontend()
        socket.emit('PONG', { timestamp: Date.now() })
        break
      }
      
      case 'SET_LOCATION': {
        if (!this.status.tunnelActive) {
          dbg(`[companion-server] ⚠️ SET_LOCATION ignoré : tunnel non prêt`)
          socket.emit('STATUS_UPDATE', { error: 'Initialisation du tunnel...' })
          break
        }
        const { lat, lon, name } = payload.data || {}
        if (lat !== undefined && lon !== undefined) {
          dbg(`[CMD] iPhone demande position: ${lat}, ${lon}`)
          this.status.lastInjectedLocation = { lat, lon, name }
          this._refreshStatus()
          this.emit('request-location', { lat, lon, name })
          if (name) favoritesManager.addToHistory({ lat, lon, name })
          socket.emit('ACK', { lat, lon, timestamp: Date.now() })
        }
        break
      }

      case 'CLEAR_LOCATION': {
        dbg(`[CMD] iPhone demande suppression position`)
        this.emit('request-clear')
        socket.emit('ACK', { timestamp: Date.now() })
        break
      }
      case 'PLAY_SEQUENCE':
      case 'PLAY_OSRM_ROUTE':
      case 'PLAY_CUSTOM_GPX': {
        if (!this.status.tunnelActive) {
          dbg(`[companion-server] ⚠️ ${payload.type} ignoré : tunnel non prêt`)
          socket.emit('STATUS_UPDATE', { error: 'Initialisation du tunnel...' })
          break
        }
        this._handleRouteMessage(socket, payload)
        break
      }
      
      case 'STOP_ROUTE': {
        gpsBridge.stopRoute()
        socket.emit('ACK', { timestamp: Date.now() })
        break
      }

      case 'PAUSE_ROUTE': {
        gpsBridge.pauseRoute()
        socket.emit('ACK', { timestamp: Date.now() })
        break
      }

      case 'RESUME_ROUTE': {
        gpsBridge.resumeRoute()
        socket.emit('ACK', { timestamp: Date.now() })
        break
      }
      
      case 'ADD_HISTORY': {
        if (payload.data) favoritesManager.addToHistory(payload.data)
        break
      }
      
      case 'ADD_FAVORITE': {
        if (payload.data) favoritesManager.addFavorite(payload.data)
        break
      }
      
      case 'REMOVE_FAVORITE': {
        if (payload.data) favoritesManager.removeFavorite(payload.data.lat, payload.data.lon)
        break
      }
      
      case 'RENAME_FAVORITE': {
        if (payload.data) favoritesManager.renameFavorite(payload.data.lat, payload.data.lon, payload.data.newName)
        break
      }

      case 'SAVE_SETTINGS': {
        const oldMode = settings.get('operationMode')
        const newMode = payload.data.operationMode
        
        settings.save(payload.data)
        
        if (newMode === 'autonomous' && oldMode !== 'autonomous') {
          dbg('[companion-server] 🔒 Mode Autonome activé : Les nouvelles connexions iPhone sont désormais refusées.')
        } else if (newMode !== 'autonomous' && oldMode === 'autonomous') {
          dbg('[companion-server] 🔓 Mode Autonome désactivé : Les connexions iPhone sont de nouveau autorisées.')
        }

        if (payload.data.logLevel) {
          const { setLogLevel } = require('../../logger')
          setLogLevel(payload.data.logLevel)
        }
        this._refreshStatus()
        this.emit('settings-updated', settings.get())
        this._broadcast('STATUS', this.status)
        break
      }

      case 'REAL_LOCATION': {
        const { latitude, longitude } = payload.data || {}
        if (latitude !== undefined && longitude !== undefined) {
          this._validatePosition(latitude, longitude)
        }
        break
      }

      case 'GET_STATUS': {
        this._refreshStatus()
        socket.emit('STATUS', this.status)
        break
      }

      case 'DEBUG_LOG': {
        // Rediffusion du log iPhone vers le Dashboard
        this._broadcast('status-update', { service: 'client-log', data: { message: payload.data, type: 'info' } })
        break
      }
    }
  }

  _handleRouteMessage(socket, payload) {
    switch (payload.type) {
      case 'PLAY_ROUTE': {
        const { endLat, endLon, speed } = payload.data || {}
        if (endLat !== undefined && endLon !== undefined) {
          const start = this.status.lastVerifiedLocation || this.status.lastInjectedLocation
          if (!start) break
          const gpxPath = routeGenerator.generateOrthodromicGpx(
            { lat: start.lat, lon: start.lon },
            { lat: endLat, lon: endLon },
            speed || 5
          )
          gpsBridge.playGpx(gpxPath)
          this.status.state = 'moving'
          this._broadcast('STATUS', this.status)
        }
        break
      }

      case 'PLAY_SEQUENCE': {
        const { legs } = payload.data || {}
        if (legs && legs.length > 0) {
          routeGenerator.generateMultimodalGpx(legs).then(gpxPath => {
            gpsBridge.playGpx(gpxPath)
            this.status.state = 'moving'
            this._broadcast('STATUS', this.status)
          })
        }
        break
      }

      case 'PLAY_OSRM_ROUTE': {
        const { endLat, endLon, profile, speed } = payload.data || {}
        if (endLat !== undefined && endLon !== undefined) {
          const start = this.status.lastVerifiedLocation || this.status.lastInjectedLocation
          if (!start) break
          routeGenerator.generateOsrmRoute(
            { lat: start.lat, lon: start.lon },
            { lat: endLat, lon: endLon },
            profile || 'driving',
            speed
          ).then(gpxPath => {
            gpsBridge.playGpx(gpxPath)
            this.status.state = 'moving'
            this._broadcast('STATUS', this.status)
          })
        }
        break
      }

      case 'PLAY_CUSTOM_GPX': {
        const { gpxContent, speed } = payload.data || {}
        if (gpxContent) {
          const gpxPath = routeGenerator.processExternalGpx(gpxContent, speed)
          gpsBridge.playGpx(gpxPath)
          this.status.state = 'moving'
          this._broadcast('STATUS', this.status)
        }
        break
      }
    }
  }

  stop() {
    if (this.io) {
      this.io.close()
      this.io = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
  }

  _broadcast(event, data) {
    if (this.io) {
      this.io.emit(event, data)
    }
    // Événement interne pour index-headless (Docker SSE)
    this.emit('broadcast', { event, data })
  }

  _updateFrontend() {
    const clientsCount = this.io ? this.io.engine.clientsCount : 0
    if (clientsCount > 0) {
      sendStatus('companion', 'ready', 'iPhone actif')
    } else {
      sendStatus('companion', 'info', 'Attente iPhone...')
    }
  }

  _checkActivity() {
    const clientsCount = this.io ? this.io.engine.clientsCount : 0
    if (clientsCount === 0) {
      this.status.maintainActive = false
      this._updateFrontend()
    }
  }

  /**
   * Valide la position réelle de l'iPhone et ré-injecte si dérive critique
   */
  _validatePosition(realLat, realLon) {
    const target = this.status.lastInjectedLocation || this.status.lastVerifiedLocation
    if (!target) return

    const dist = this._calculateDistance(realLat, realLon, target.lat, target.lon)
    this.status.lastRealLocation = { lat: realLat, lon: realLon, drift: dist, timestamp: Date.now() }

    // --- LOGIQUE DE BOUCLIER INTELLIGENT ---
    // 1. Seuil de tolérance élevé (100m) pour éviter les faux positifs
    if (dist > 100) {
      this._consecutiveValidationFailures++
      dbg(`[companion-server] 🛡️ Alerte dérive (${dist.toFixed(0)}m) - Échec ${this._consecutiveValidationFailures}/2`)

      // 2. Double validation temporelle (nécessite 2 échecs consécutifs)
      if (this._consecutiveValidationFailures >= 2) {
        const now = Date.now()
        // 3. Cooldown de sécurité (15s)
        if (now - this._lastAutoReinjectionTime > 15000) {
          dbg(`[companion-server] 🚨 Dérive critique confirmée. Ré-injection de sécurité forcée !`)
          this.emit('request-location', { ...target, force: true })
          this._lastAutoReinjectionTime = now
          this._consecutiveValidationFailures = 0
        }
      }
    } else {
      // Position cohérente
      this._consecutiveValidationFailures = 0
      this.status.lastVerifiedLocation = { ...target, timestamp: Date.now() }
    }

    this._broadcast('STATUS_UPDATE', { 
      lastRealLocation: this.status.lastRealLocation, 
      lastVerifiedLocation: this.status.lastVerifiedLocation 
    })
  }

  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3 // Rayon de la Terre en mètres
    const φ1 = lat1 * Math.PI / 180
    const φ2 = lat2 * Math.PI / 180
    const Δφ = (lat2 - lat1) * Math.PI / 180
    const Δλ = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  getConnectionInfo() {
    const ip = this.getLocalIp()
    return {
      ip,
      port: this.port || settings.get('companionPort') || 8080,
      url: `ws://${ip}:${this.port || settings.get('companionPort') || 8080}`
    }
  }

  getLocalIp() {
    const interfaces = os.networkInterfaces()
    const candidates = []
    
    // On cherche d'abord les interfaces physiques (eth, en, br)
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (name.startsWith('eth') || name.startsWith('en') || name.startsWith('br')) {
            return iface.address
          }
          candidates.push(iface.address)
        }
      }
    }
    
    // Si on a une IP forcée en config, on vérifie qu'elle existe vraiment
    const serverIp = settings.get('serverIp')
    if (serverIp && candidates.includes(serverIp)) {
      return serverIp
    }

    return candidates[0] || '127.0.0.1'
  }
}

module.exports = CompanionServer
