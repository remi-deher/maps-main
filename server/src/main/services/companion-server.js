'use strict'

const WebSocket = require('ws')
const { WebSocketServer } = WebSocket
const os = require('os')
const http = require('http')
const fs = require('fs')
const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const favoritesManager = require('./favorites-manager')
const settings = require('./settings-manager')
const routeGenerator = require('./gps/route-generator')

/**
 * CompanionServer - Gere la communication WebSocket avec l'application iOS
 */
class CompanionServer extends EventEmitter {
  constructor(tunnelManager) {
    super()
    this.tunnel = tunnelManager
    this.wss = null
    this.httpServer = null
    this.app = express() // Utilisation d'Express pour Docker
    this.port = null
    this.clients = new Set()
    this.status = {}
    this.lastDriftRelance = 0 // Cooldown pour éviter les rafales
    
    // Configurer Express
    this.app.use(bodyParser.json())
    this._setupRoutes()
    
    // Initialisation du statut
    this._refreshStatus()

    // ... (rest of constructor same)

    // Ecouter les mises a jour des favoris/historique
    // On envoie STATUS_UPDATE (pas STATUS complet) pour ne pas déclencher la logique
    // de restauration "serveur vierge" sur le client.
    favoritesManager.on('favorites-updated', (favs) => {
      this.status.favorites = favs
      this._broadcast({ type: 'STATUS_UPDATE', data: { favorites: favs } })
      this.emit('favorites-updated', favs)
    })

    favoritesManager.on('history-updated', (history) => {
      this.status.recentHistory = history
      this._broadcast({ type: 'STATUS_UPDATE', data: { recentHistory: history } })
      this.emit('history-updated', history)
    })

    // Ecouter les mises a jour du tunnel/appareil
    if (this.tunnel) {
      this.tunnel.setOnStatusChange(() => {
        this._refreshStatus()
        this._broadcast({ type: 'STATUS', data: this.status })
      })
    }
  }

  _refreshStatus() {
    const rsdReady = !!this.tunnel?.getRsdAddress();
    const isStarting = this.tunnel?.isStarting ? this.tunnel.isStarting() : false;
    const simActive = !!(rsdReady && this.status?.lastVerifiedLocation);

    // Les états manuels ('moving') ne doivent JAMAIS être écrasés par _refreshStatus.
    // Seuls 'idle', 'ready', 'running', 'starting' sont calculés dynamiquement.
    const manualStates = ['moving']
    const currentState = this.status?.state
    
    let computedState = 'idle';
    if (simActive) computedState = 'running';
    else if (rsdReady) computedState = 'ready';
    else if (isStarting) computedState = 'starting';
    
    // Préserver l'état manuel sauf si le tunnel n'est plus actif
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
      usbDriver: settings.get('usbDriver'),
      wifiDriver: settings.get('wifiDriver'),
      fallbackEnabled: settings.get('fallbackEnabled'),
      favorites: favoritesManager.getFavorites(),
      recentHistory: favoritesManager.getHistory()
    }
  }

  /**
   * Appelé par le GpsSimulator pour confirmer que la position est bien injectée sur l'iPhone
   */
  confirmLocationApplied(lat, lon, name) {
    this.status.lastVerifiedLocation = { lat, lon, name, timestamp: Date.now() };
    this._refreshStatus();
    this._broadcast({ type: 'STATUS', data: this.status });
  }

  _setupRoutes() {
    // API d'enrôlement déporté (iOS-Enroller)
    this.app.post('/api/enroll', (req, res) => {
      const { udid, selfIdentity, deviceRecord } = req.body
      if (!udid || !selfIdentity || !deviceRecord) return res.status(400).json({ error: 'Données manquantes' })

      try {
        dbg(`[enroll] Réception certificat pour UDID: ${udid}`)
        
        // 1. Sauvegarder l'identité hôte (à la racine du projet, parent de /server)
        const projectRoot = path.join(__dirname, '..', '..', '..')
        fs.writeFileSync(path.join(projectRoot, 'selfIdentity.plist'), selfIdentity)

        // 2. Déterminer le dossier Lockdown selon l'OS
        let lockdownDir = 'C:\\ProgramData\\Apple\\Lockdown'
        if (process.platform === 'linux') {
          lockdownDir = '/var/lib/lockdown'
          if (!fs.existsSync(lockdownDir)) {
            fs.mkdirSync(lockdownDir, { recursive: true })
          }
        }

        const devicePath = path.join(lockdownDir, `${udid}.plist`)
        fs.writeFileSync(devicePath, deviceRecord)
        
        dbg(`[enroll] ✅ Certificats installés avec succès dans ${lockdownDir}`)
        res.json({ success: true, message: 'Enrôlement réussi sur le serveur' })
      } catch (err) {
        dbg(`[enroll] ❌ Erreur installation: ${err.message}`)
        res.status(500).json({ error: err.message })
      }
    })

    // API Status pour le Dashboard
    this.app.get('/api/status', (req, res) => {
      res.json(this.status)
    })

    // Gestion de la détection de dérive (RELANCE)
    this.app.post('/api/relance', (req, res) => {
      const { lat, lon, name } = req.body
      if (lat === undefined || lon === undefined) return res.status(400).end()

      // Cooldown de 45s
      const now = Date.now()
      if (now - this.lastDriftRelance < 45000) {
        return res.json({ ignored: 'cooldown' })
      }

      // Vérifier si proche de la cible
      const target = this.status?.lastInjectedLocation
      if (target) {
        const dLat = Math.abs(target.lat - lat)
        const dLon = Math.abs(target.lon - lon)
        if (dLat < 0.001 && dLon < 0.001) return res.json({ success: true, note: 'near_target' })
      }

      this.lastDriftRelance = now

      // Ignorer si tunnel en cours
      if (this.status.state === 'starting' || this.status.state === 'ready') {
        dbg(`[companion-server] ⏳ Dérive ignorée (Initialisation: ${this.status.state})`)
        return res.json({ ignored: 'init' })
      }

      dbg(`[companion-server] ⚠️ DÉRIVE DÉTECTÉE sur l'iPhone (${lat}, ${lon}). Relance forcée...`)
      sendStatus('companion', 'info', `Secours : Simulation forcée (Dérive détectée)`)
      this.emit('request-location', { lat, lon, name, force: true })
      res.json({ success: true })
    })
  }

  /**
   * Demarre le serveur WebSocket + HTTP
   */
  start(port = 8080) {
    if (this.httpServer && this.port === port) {
      dbg(`[companion-server] Serveur deja actif sur le port ${port}`)
      return
    }
    
    if (this.httpServer) {
      dbg(`[companion-server] Changement de port ${this.port} -> ${port}`)
      this.stop()
    }

    try {
      this.port = port
      
      // Creation du serveur HTTP via Express
      this.httpServer = http.createServer(this.app)

      // Attacher le WebSocket au serveur HTTP
      this.wss = new WebSocketServer({ server: this.httpServer })
      
      const ip = this._getLocalIp()
      
      this.httpServer.listen(port, () => {
        dbg(`[companion-server] Serveur (HTTP+WS) demarre sur ${ip}:${port}`)
        sendStatus('companion', 'info', `Pret pour connexion iPhone sur ${ip}:${port}`)
      })

      this.wss.on('connection', (ws, req) => {
        let clientIp = req.socket.remoteAddress
        if (clientIp.startsWith('::ffff:')) clientIp = clientIp.substring(7)
        
        dbg(`[companion-server] Nouveau client connecte : ${clientIp}`)
        this.emit('iphone-ip-detected', clientIp)
        
        this.clients.add(ws)
        this._refreshStatus()
        ws.send(JSON.stringify({ type: 'STATUS', data: this.status }))

        ws.on('message', (message) => {
          try {
            const payload = JSON.parse(message)
            if (payload && payload.type) {
              dbg(`[IN]  <- iPhone: ${payload.type}${payload.type === 'HEARTBEAT' ? '' : ' ' + JSON.stringify(payload.data || {})}`)
              this._handleMessage(ws, payload)
            }
          } catch (e) {
            dbg(`[ERR] Erreur message: ${e.message}`)
          }
        })

        ws.on('close', () => {
          dbg('[companion-server] Client deconnecte')
          this.clients.delete(ws)
          this._checkActivity()
        })

        ws.on('error', (err) => {
          dbg(`[companion-server] Erreur client: ${err.message}`)
          this.clients.delete(ws)
        })
      })

      this.wss.on('error', (err) => {
        dbg(`[companion-server] Erreur CRITIQUE serveur: ${err.message}`)
        sendStatus('companion', 'error', `Erreur serveur : ${err.message}`)
      })

    } catch (e) {
      dbg(`[companion-server] Erreur demarrage: ${e.message}`)
      sendStatus('companion', 'error', `Erreur serveur compagnon : ${e.message}`)
    }
  }

  updateTunnelStatus(active) {
    this._refreshStatus()
    this.status.tunnelActive = active
    this._broadcast({ type: 'STATUS', data: this.status })
    this._updateFrontend()
  }

  broadcastLocation(lat, lon, name = '') {
    this._broadcast({ 
      type: 'LOCATION', 
      data: { lat, lon, name } 
    })
  }

  getConnectionInfo() {
    return {
      ip: this._getLocalIp(),
      port: this.port || 8080,
      url: `ws://${this._getLocalIp()}:${this.port || 8080}`
    }
  }

  _handleMessage(ws, payload) {
    switch (payload.type) {
      case 'HEARTBEAT': {
        if (payload.data) {
          this.status.maintainActive = payload.data.isMaintaining || false
        }
        this.status.lastHeartbeat = Date.now()
        this._updateFrontend()
        const pong = JSON.stringify({ type: 'PONG', timestamp: Date.now() })
        ws.send(pong)
        break
      }
      
      case 'SET_LOCATION': {
        const { lat, lon, name } = payload.data || {}
        if (lat !== undefined && lon !== undefined) {
          // Anti-rafale : ignorer les positions identiques envoyees en <3s
          const now = Date.now()
          const last = this._lastSetTs || {}
          const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
          if (this._lastSetKey === key && now - (last[key] || 0) < 3000) {
            const ack = JSON.stringify({ type: 'ACK', data: { lat, lon, timestamp: now } })
            ws.send(ack)
            break
          }
          this._lastSetKey = key
          if (!this._lastSetTs) this._lastSetTs = {}
          this._lastSetTs[key] = now

          dbg(`[CMD] iPhone demande position: ${lat}, ${lon} (${name || 'sans nom'})`)
          this.status.lastInjectedLocation = { lat, lon, name }
          this._refreshStatus()
          this.emit('request-location', { lat, lon, name })
          if (name) favoritesManager.addToHistory({ lat, lon, name })
          
          const ack = JSON.stringify({ type: 'ACK', data: { lat, lon, timestamp: Date.now() } })
          dbg(`[OUT] -> iPhone: ACK`)
          ws.send(ack)
        }
        break
      }

      case 'PLAY_ROUTE': {
        const { endLat, endLon, speed } = payload.data || {}
        if (endLat !== undefined && endLon !== undefined) {
          const start = this.status.lastVerifiedLocation || this.status.lastInjectedLocation
          if (!start) {
            dbg(`[companion-server] ❌ PLAY_ROUTE annulé : Point de départ inconnu`)
            break
          }
          
          dbg(`[CMD] iPhone demande navigation vers: ${endLat}, ${endLon} à ${speed} km/h`)
          const gpxPath = routeGenerator.generateOrthodromicGpx(
            { lat: start.lat, lon: start.lon },
            { lat: endLat, lon: endLon },
            speed || 5
          )
          
          const gpsBridge = require('./gps/gps-bridge')
          gpsBridge.playGpx(gpxPath)
          
          this.status.state = 'moving'
          this._broadcast({ type: 'STATUS', data: this.status })
        }
        break
      }

      case 'PLAY_SEQUENCE': {
        const { legs } = payload.data || {}
        if (legs && legs.length > 0) {
          dbg(`[CMD] iPhone envoie une séquence multimodale (${legs.length} étapes)`)
          routeGenerator.generateMultimodalGpx(legs).then(gpxPath => {
            const gpsBridge = require('./gps/gps-bridge')
            gpsBridge.playGpx(gpxPath)
            this.status.state = 'moving'
            this._broadcast({ type: 'STATUS', data: this.status })
          }).catch(err => {
            dbg(`[companion-server] ❌ Erreur generateMultimodalGpx: ${err.message}`)
          })
        }
        break
      }

      case 'PLAY_OSRM_ROUTE': {
        const { endLat, endLon, profile, speed } = payload.data || {}
        if (endLat !== undefined && endLon !== undefined) {
          const start = this.status.lastVerifiedLocation || this.status.lastInjectedLocation
          if (!start) break
          
          dbg(`[CMD] iPhone demande itinéraire OSRM (${profile}) vers: ${endLat}, ${endLon}`)
          
          // On ne bloque pas le WS (c'est asynchrone)
          routeGenerator.generateOsrmRoute(
            { lat: start.lat, lon: start.lon },
            { lat: endLat, lon: endLon },
            profile || 'driving',
            speed
          ).then(gpxPath => {
            const gpsBridge = require('./gps/gps-bridge')
            gpsBridge.playGpx(gpxPath)
            this.status.state = 'moving'
            this._broadcast({ type: 'STATUS', data: this.status })
          }).catch(err => {
            dbg(`[companion-server] ❌ Erreur generateOsrmRoute: ${err.message}`)
          })
        }
        break
      }

      case 'PLAY_CUSTOM_GPX': {
        const { gpxContent, speed } = payload.data || {}
        if (gpxContent) {
          try {
            dbg(`[CMD] iPhone envoie un GPX personnalisé (vitesse override: ${speed || 'non'})`)
            const gpxPath = routeGenerator.processExternalGpx(gpxContent, speed)
            
            const gpsBridge = require('./gps/gps-bridge')
            gpsBridge.playGpx(gpxPath)
            
            this.status.state = 'moving'
            this._broadcast({ type: 'STATUS', data: this.status })
          } catch (e) {
            dbg(`[companion-server] ❌ Erreur PLAY_CUSTOM_GPX: ${e.message}`)
          }
        }
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
      
      case 'CLIENT_LOG': {
        this.emit('client-log', payload.data)
        break
      }

      case 'SAVE_SETTINGS': {
        if (payload.data) {
          dbg(`[CMD] iPhone demande mise à jour réglages: ${JSON.stringify(payload.data)}`)
          settings.save(payload.data)
          if (this.tunnel && (payload.data.usbDriver || payload.data.wifiDriver)) {
             this.tunnel.applySettings(settings.get())
          }
          this._refreshStatus()
          this._broadcast({ type: 'STATUS', data: this.status })
        }
        break
      }

      case 'GET_STATUS': {
        this._refreshStatus()
        ws.send(JSON.stringify({ type: 'STATUS', data: this.status }))
        break
      }
    }
  }

  // Facades pour appeler la logique metier via le dashboard (ou autres)
  addFavorite(fav) { return favoritesManager.addFavorite(fav) }
  removeFavorite(lat, lon) { return favoritesManager.removeFavorite(lat, lon) }
  renameFavorite(lat, lon, newName) { return favoritesManager.renameFavorite(lat, lon, newName) }

  stop() {
    if (this.wss) {
      dbg('[companion-server] Arret du serveur WebSocket...')
      this.wss.close()
      this.wss = null
    }
    if (this.httpServer) {
      dbg('[companion-server] Arret du serveur HTTP...')
      this.httpServer.close()
      this.httpServer = null
    }
  }

  _broadcast(data) {
    if (!this.wss) return
    const message = JSON.stringify(data)
    if (data.type !== 'STATUS' || this.clients.size > 0) {
        dbg(`[OUT] -> iPhone: ${data.type}`)
    }
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message)
      }
    }
  }

  _updateFrontend() {
    if (this.clients.size > 0) {
      if (this.status.maintainActive) {
        sendStatus('companion', 'ready', 'iPhone connecte & actif')
      } else {
        sendStatus('companion', 'info', 'iPhone connecte (en attente)')
      }
    } else {
      sendStatus('companion', 'info', 'En attente de connexion iPhone...')
    }
  }

  _checkActivity() {
    if (this.clients.size === 0) {
      this.status.maintainActive = false
      this._updateFrontend()
    }
  }

  _getLocalIp() {
    const serverIp = settings.get('serverIp')
    const interfaces = os.networkInterfaces()
    
    // Si une IP est forcée, on vérifie si elle est toujours disponible
    if (serverIp) {
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && iface.address === serverIp) {
            return serverIp
          }
        }
      }
    }

    // Fallback sur la première interface valide
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address
      }
    }
    return '127.0.0.1'
  }
}

module.exports = CompanionServer
