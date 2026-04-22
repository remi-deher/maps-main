'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const { PYTHON } = require('../python-resolver')
const { TUNNEL_RESTART_DELAY } = require('../constants')
const nativeBonjour = require('./native-bonjour')

/**
 * TunneldService - Gère le démon pymobiledevice3 remote tunneld
 * Supporte USB et WiFi via une découverte unifiée.
 */
class TunneldService extends EventEmitter {
  constructor() {
    super()
    this.process = null
    this.restartTimer = null
    this.fallbackTimer = null
    this._isQuitting = false
    this.devices = new Map() // udid -> connectionInfo
    this.heartbeatProcesses = new Map() // udid -> process
    this.activeConnection = null // { address, port, type, id }
  }

  start(manualIp = null) {
    if (this._isQuitting) return
    this.stop()

    this._manualIp = manualIp
    dbg('[tunneld-service] lancement du démon tunneld...')
    sendStatus('tunneld', 'starting', 'Initialisation du démon tunnel...')

    // On lance tunneld. Sur Windows, il surveille usbmux et Bonjour.
    this.process = spawn(PYTHON, ['-m', 'pymobiledevice3', 'remote', 'tunneld'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Fallback : Si après 10s on n'a rien trouvé, on tente dns-sd + manuel
    this.fallbackTimer = setTimeout(() => this._triggerNativeFallback(this._manualIp), 10000)

    const onData = (data) => {
      const text = data.toString().trim()
      if (!text) return
      dbg(`[tunneld] ${text}`)

      // Format flexible pour capturer IP et Port même avec des prefixes/couleurs
      const matchRsd = text.match(/--rsd\s+([\w:.]+)\s+(\d+)/)
      
      if (matchRsd) {
        const address = matchRsd[1]
        const port = matchRsd[2]

        // On cherche l'ID de l'appareil dans toute la ligne
        // format : [start-tunnel-task-usbmux-UDID-TYPE]
        // L'UDID peut contenir des tirets, donc on prend tout jusqu'au dernier tiret
        const matchId = text.match(/\[start-tunnel-task-usbmux-(.+)-([^-]+)\]/)
        const deviceId = matchId ? matchId[1] : 'unknown'
        const typeRaw = matchId ? matchId[2] : ''
        
        const isUSB = typeRaw.toLowerCase().includes('usb')
        const type = isUSB ? 'USB' : 'WiFi'

        // On a trouvé, on annule le fallback
        if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null }

        // Anti-doublon : Si on est déjà connecté sur cette IP/Port, on ignore
        if (this.activeConnection && this.activeConnection.address === address && this.activeConnection.port === port) return

        dbg(`[tunneld] Connexion détectée : ${type} (${address}:${port})`)
        sendStatus('tunneld', 'ready', `iPhone détecté via ${type} (${address}:${port})`, { type })
        
        // Démarrage du heartbeat pour garder l'iPhone réveillé
        this._startHeartbeat(deviceId, type === 'WiFi')

        this.activeConnection = { address, port, type, id: deviceId }
        this.emit('connection', this.activeConnection)
      }

      // Détection de déconnexion plus robuste
      if (text.includes('Disconnected from tunnel') || 
          text.includes('terminating') || 
          text.includes('Tunnel task failed')) {
        dbg(`[tunneld-service] !!! DECONNEXION DETECTEE !!! Motif : ${text}`)
        this._stopAllHeartbeats()
        this.activeConnection = null
        this.emit('disconnection', text)
      }

      // Détection d'erreurs fatales
      if (text.toLowerCase().includes('error') && text.includes('usbmux')) {
        this.emit('error', text)
      }
    }

    this.process.stdout.on('data', onData)
    this.process.stderr.on('data', onData)

    this.process.on('exit', (code, signal) => {
      if (this._isQuitting || this.restartTimer) return
      dbg(`[tunneld] Arrêt du processus (code ${code}, signal ${signal})`)
      this.emit('disconnection', 'Démon tunnel arrêté')
      this._scheduleRestart(TUNNEL_RESTART_DELAY)
    })
  }

  _startHeartbeat(udid, isWiFi) {
    if (this.heartbeatProcesses.has(udid)) return
    
    dbg(`[tunneld-service] Démarrage du battement de coeur (heartbeat) pour ${udid}...`)
    const args = ['-m', 'pymobiledevice3', 'lockdown', 'heartbeat', '--udid', udid]
    if (isWiFi) args.push('--mobdev2')

    const proc = spawn(PYTHON, args)
    this.heartbeatProcesses.set(udid, proc)

    proc.on('exit', () => {
      if (this.heartbeatProcesses.get(udid) === proc) {
        this.heartbeatProcesses.delete(udid)
      }
    })
  }

  _stopAllHeartbeats() {
    for (const [udid, proc] of this.heartbeatProcesses) {
      dbg(`[tunneld-service] Arrêt heartbeat pour ${udid}`)
      try { proc.kill() } catch (_) {}
    }
    this.heartbeatProcesses.clear()
  }

  async _triggerNativeFallback(manualIp = null) {
    if (this._isQuitting || this.activeConnection) return
    dbg('[tunneld-service] Aucun appareil détecté via tunneld. Test via Bonjour Natif (dns-sd)...')
    sendStatus('tunneld', 'info', 'Recherche approfondie via Bonjour Natif...')
    
    let targetData = null
    const instances = await nativeBonjour.scan(5000)
    
    if (instances.length > 0) {
      targetData = await nativeBonjour.resolve(instances[0])
    }
    
    // DERNIER RECOURS : Si on n'a rien trouvé via Bonjour, on tente l'IP manuelle si elle existe
    if (!targetData && manualIp) {
      dbg(`[tunneld-service] Échec Bonjour. Tentative forcée sur l'IP manuelle : ${manualIp}...`)
      sendStatus('tunneld', 'info', `Tentative forcée sur ${manualIp}...`)
      const port = await nativeBonjour._probeIPv6(manualIp) // _probeIPv6 gère aussi l'IPv4
      if (port) {
        targetData = { address: manualIp, port }
      }
    }

    if (targetData && targetData.port) {
      if (this.activeConnection) return
      
      const address = targetData.address || 'fe80::1'
      dbg(`[tunneld-service] Appareil trouvé et résolu ! ${address}:${targetData.port}`)
      sendStatus('tunneld', 'ready', `iPhone synchronisé via ${targetData.address}`, { type: 'WiFi' })
      this.emit('connection', { address, port: targetData.port, type: 'WiFi' })
    } else if (instances.length > 0) {
      dbg('[tunneld-service] iPhone trouvé mais le tunnel RSD n\'est pas encore prêt.')
      sendStatus('tunneld', 'starting', 'iPhone détecté... Initialisation du tunnel (Déverrouillez-le)')
    } else {
      dbg('[tunneld-service] Aucun appareil détecté sur le réseau ou en USB.')
      sendStatus('tunneld', 'stopped', 'iPhone non détecté (Vérifiez la connexion ou déverrouillez)')
    }
  }

  _scheduleRestart(delay) {
    if (this._isQuitting || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start()
    }, delay)
  }

  stop() {
    this.activeConnection = null
    this._stopAllHeartbeats()
    if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.process) {
      this.process.removeAllListeners()
      try { this.process.kill('SIGTERM') } catch (_) {}
      this.process = null
    }
  }

  stopHeartbeats() {
    this._stopAllHeartbeats()
  }

  destroy() {
    this._isQuitting = true
    this.stop()
  }
}

module.exports = TunneldService
