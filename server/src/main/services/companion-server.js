'use strict'

const { Server } = require('socket.io')
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
      this.tunnel.setOnStatusChange(() => {
        this._refreshStatus()
        this._broadcast('STATUS', this.status)
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
      usbDriver: settings.get('usbDriver'),
      wifiDriver: settings.get('wifiDriver'),
      fallbackEnabled: settings.get('fallbackEnabled'),
      favorites: favoritesManager.getFavorites(),
      recentHistory: favoritesManager.getHistory()
    }
  }

  confirmLocationApplied(lat, lon, name) {
    this.status.lastVerifiedLocation = { lat, lon, name, timestamp: Date.now() };
    this._refreshStatus();
    this._broadcast('STATUS', this.status);
  }

  _setupRoutes() {
    this.app.post('/api/enroll', (req, res) => {
      const { udid, selfIdentity, deviceRecord } = req.body
      if (!udid || !selfIdentity || !deviceRecord) return res.status(400).json({ error: 'Données manquantes' })
      try {
        const projectRoot = path.join(__dirname, '..', '..', '..')
        fs.writeFileSync(path.join(projectRoot, 'selfIdentity.plist'), selfIdentity)
        let lockdownDir = 'C:\\ProgramData\\Apple\\Lockdown'
        if (process.platform === 'linux') {
          lockdownDir = '/var/lib/lockdown'
          if (!fs.existsSync(lockdownDir)) fs.mkdirSync(lockdownDir, { recursive: true })
        }
        const devicePath = path.join(lockdownDir, `${udid}.plist`)
        fs.writeFileSync(devicePath, deviceRecord)
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
  }

  start(port = 8080) {
    if (this.httpServer) this.stop()

    try {
      this.port = port
      this.httpServer = http.createServer(this.app)
      this.io = new Server(this.httpServer, {
        cors: { origin: "*" }
      })
      
      const ip = this._getLocalIp()
      
      this.httpServer.listen(port, () => {
        dbg(`[companion-server] Serveur (Socket.io) demarre sur ${ip}:${port}`)
        sendStatus('companion', 'info', `Prêt sur ${ip}:${port}`)
      })

      this.io.on('connection', (socket) => {
        dbg(`[companion-server] Nouveau client connecte : ${socket.id}`)
        this._refreshStatus()
        socket.emit('STATUS', this.status)

        const actions = [
          'SET_LOCATION', 'PLAY_ROUTE', 'PLAY_SEQUENCE', 'PLAY_OSRM_ROUTE', 
          'PLAY_CUSTOM_GPX', 'ADD_HISTORY', 'ADD_FAVORITE', 'REMOVE_FAVORITE', 
          'RENAME_FAVORITE', 'SAVE_SETTINGS', 'GET_STATUS', 'HEARTBEAT'
        ]

        actions.forEach(event => {
          socket.on(event, (data) => {
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
        if (payload.data) this.status.maintainActive = payload.data.isMaintaining || false
        this.status.lastHeartbeat = Date.now()
        this._updateFrontend()
        socket.emit('PONG', { timestamp: Date.now() })
        break
      }
      
      case 'SET_LOCATION': {
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

      case 'PLAY_ROUTE':
      case 'PLAY_SEQUENCE':
      case 'PLAY_OSRM_ROUTE':
      case 'PLAY_CUSTOM_GPX': {
        // Logique métier déléguée (inchangée mais adaptée aux events)
        this.emit(payload.type, payload.data)
        this.status.state = 'moving'
        this._broadcast('STATUS', this.status)
        break
      }
      
      case 'ADD_FAVORITE':
      case 'REMOVE_FAVORITE':
      case 'RENAME_FAVORITE': {
        this.emit(payload.type, payload.data)
        break
      }

      case 'SAVE_SETTINGS': {
        settings.save(payload.data)
        this._refreshStatus()
        this._broadcast('STATUS', this.status)
        break
      }

      case 'GET_STATUS': {
        this._refreshStatus()
        socket.emit('STATUS', this.status)
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

  _getLocalIp() {
    const serverIp = settings.get('serverIp')
    const interfaces = os.networkInterfaces()
    if (serverIp) {
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && iface.address === serverIp) return serverIp
        }
      }
    }
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address
      }
    }
    return '127.0.0.1'
  }
}

module.exports = CompanionServer
