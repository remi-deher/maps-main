'use strict'

const WebSocket = require('ws')
const { WebSocketServer } = WebSocket
const os = require('os')
const http = require('http')
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
    this.port = null
    this.clients = new Set()
    this.status = {}
    this.lastDriftRelance = 0 // Cooldown pour éviter les rafales
    
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
      
      // Creation du serveur HTTP pour gerer les requetes de secours (Background)
      this.httpServer = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/relance') {
          let body = ''
          req.on('data', chunk => body += chunk.toString())
          req.on('end', () => {
            try {
              const payload = JSON.parse(body)
              const { lat, lon, name } = payload
              if (lat !== undefined && lon !== undefined) {
                const now = Date.now()
                // Cooldown de 45s : après une injection réussie, l'iPhone mettra du
                // temps à rapporter à nouveau sa vraie position GPS. Sans ce délai long,
                // chaque rapport de position réelle (loin de la cible) déclencherait
                // une relance infinie.
                if (now - this.lastDriftRelance < 45000) {
                  dbg(`[companion-server] ⏳ Dérive ignorée (cooldown 45s actif)`)
                  res.writeHead(200)
                  res.end()
                  return
                }

                // Vérifier si la dérive concerne bien la position ACTUELLE
                // Si le rapport de position est très proche de la cible injectée (<100m),
                // c'est que l'injection a réussi — pas de relance nécessaire.
                const target = this.status?.lastInjectedLocation
                if (target) {
                  const dLat = Math.abs(target.lat - lat)
                  const dLon = Math.abs(target.lon - lon)
                  if (dLat < 0.001 && dLon < 0.001) {
                    dbg(`[companion-server] ✅ Position proche de la cible, injection confirmée`)
                    res.writeHead(200)
                    res.end()
                    return
                  }
                }

                this.lastDriftRelance = now

                // Ignorer la dérive si le tunnel est en train de monter ou vient juste d'être prêt
                // On laisse 15s au système pour ré-injecter la position après un tunnel ready.
                if (this.status.state === 'starting' || this.status.state === 'ready') {
                  dbg(`[companion-server] ⏳ Dérive ignorée (Tunnel en phase d'initialisation: ${this.status.state})`)
                  res.writeHead(200)
                  res.end()
                  return
                }

                dbg(`[companion-server] ⚠️ DÉRIVE DÉTECTÉE sur l'iPhone (${lat}, ${lon}). Relance forcée...`)
                sendStatus('companion', 'info', `Secours : Simulation forcée (Dérive détectée)`)
                this.emit('request-location', { lat, lon, name, force: true })
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true }))
                return
              }
            } catch (e) {
              dbg(`[companion-server] Erreur parsing POST /relance: ${e.message}`)
            }
            res.writeHead(400)
            res.end()
          })
          return
        }
        
        // Reponse par defaut
        res.writeHead(404)
        res.end()
      })

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
    const preferredIp = settings.get('preferredIp')
    const interfaces = os.networkInterfaces()
    
    // Si une IP est préférée, on vérifie si elle est toujours disponible
    if (preferredIp) {
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && iface.address === preferredIp) {
            return preferredIp
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
