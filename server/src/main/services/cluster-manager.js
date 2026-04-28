'use strict'

const { EventEmitter } = require('events')
const axios = require('axios')
const { dbg } = require('../logger')
const settings = require('./settings-manager')

/**
 * ClusterManager - Gère la haute disponibilité entre plusieurs serveurs
 */
class ClusterManager extends EventEmitter {
  constructor() {
    super()
    this.peers = settings.get('clusterNodes') || []
    
    // En mode standalone, on est forcément MAITRE
    if (settings.get('clusterMode') === 'standalone') {
      this.role = 'master'
      this.currentMaster = 'me'
      dbg('[cluster] 👑 Mode Standalone détecté : Auto-promotion MAÎTRE.')
    } else {
      this.role = 'slave'
      this.currentMaster = null
    }

    this._heartbeatInterval = null
    this._isQuitting = false
  }

  async init() {
    const clusterNodes = settings.get('clusterNodes') || []
    const mode = settings.get('clusterMode') || 'off'

    if (mode === 'off') return

    dbg(`[cluster] Initialisation en mode ${mode} avec ${clusterNodes.length} pairs`)
    this.peers = clusterNodes

    // Démarrage du cycle de surveillance
    this._startHeartbeat()

    // Synchro initiale des plists si on est esclave
    setTimeout(() => this._initialSync(), 2000)
  }

  async _initialSync() {
    if (this.role === 'slave' && this.currentMaster) {
      dbg(`[cluster] 📥 Tentative de synchronisation initiale des certificats...`)
      try {
        const url = `http://${this.currentMaster}:8080/api/cluster/plists` // On assume le port par défaut ou on le déduit
        const res = await axios.get(url, { timeout: 10000 })
        if (res.data && res.data.success) {
          const { plists } = res.data
          for (const p of plists) {
            await this._saveLocalPlist(p.name, p.content)
          }
          dbg(`[cluster] ✅ ${plists.length} certificats synchronisés depuis le Maître`)
        }
      } catch (e) {
        dbg(`[cluster] ❌ Échec synchro initiale: ${e.message}`)
      }
    }
  }

  async _saveLocalPlist(name, content) {
    const fs = require('fs')
    const path = require('path')
    const { app } = require('electron')
    
    try {
      const projectRoot = path.join(app.getAppPath(), '..')
      if (name === 'selfIdentity.plist') {
        fs.writeFileSync(path.join(projectRoot, 'selfIdentity.plist'), content)
      } else {
        let lockdownDir = process.platform === 'win32' ? 'C:\\ProgramData\\Apple\\Lockdown' : '/var/lib/lockdown'
        if (fs.existsSync(lockdownDir)) {
          fs.writeFileSync(path.join(lockdownDir, name), content)
        }
      }
    } catch (e) {
      dbg(`[cluster] ❌ Erreur sauvegarde plist ${name}: ${e.message}`)
    }
  }

  _startHeartbeat() {
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval)
    this._heartbeatInterval = setInterval(async () => {
      try {
        if (this._isQuitting) return
        await this._checkPeers()
        if (this.role === 'slave') {
          await this._checkMasterHealth()
        }
      } catch (e) {
        dbg(`[cluster] ⚠️ Erreur cycle Heartbeat: ${e.message}`)
      }
    }, 10000)
  }

  async _checkMasterHealth() {
    try {
      const now = Date.now()
      // Si on n'a pas vu le maître depuis 30s et qu'on est en mode Auto
      if (settings.get('clusterMode') === 'auto' && this.currentMaster && (now - this.lastMasterSeen > 30000)) {
        dbg(`[cluster] 🚨 Maître (${this.currentMaster}) injoignable depuis 30s. Tentative de Takeover !`)
        await this.takeover()
      }
    } catch (e) {
      dbg(`[cluster] ❌ Erreur CheckMasterHealth: ${e.message}`)
    }
  }

  async _checkPeers() {
    let masterFound = false
    const updatedPeers = []
    
    for (const peer of this.peers) {
      try {
        const url = `http://${peer.address}:${peer.port}/api/cluster/ping`
        const res = await axios.get(url, { timeout: 3000 })
        
        const peerData = {
          ...peer,
          online: true,
          role: res.data.role,
          mode: res.data.mode,
          name: res.data.serverName || peer.address,
          tunnelActive: res.data.tunnelActive,
          lastSeen: Date.now()
        }

        if (res.data && res.data.role === 'master') {
          this.currentMaster = peer.address
          this.lastMasterSeen = Date.now()
          masterFound = true
        }
        updatedPeers.push(peerData)
      } catch (e) {
        updatedPeers.push({ ...peer, online: false, role: 'unknown' })
      }
    }

    this.peerStatus = updatedPeers
    if (!masterFound) {
      this.currentMaster = null
    }

    // Notification à l'UI via événement
    this.emit('status-updated', this.getStatus())
  }

  async updatePeerConfig(peerAddress, peerPort, newConfig) {
    dbg(`[cluster] 📤 Envoi mise à jour config vers ${peerAddress}:${peerPort}...`)
    try {
      const url = `http://${peerAddress}:${peerPort}/api/cluster/update-config`
      await axios.post(url, newConfig, { timeout: 5000 })
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  async takeover() {
    dbg(`[cluster] 👑 Prise de contrôle du cluster...`)
    
    // 1. Changer de rôle localement d'abord
    this.role = 'master'
    this.currentMaster = 'me'
    this.lastMasterSeen = Date.now()
    this.emit('role-changed', 'master')
    this.emit('status-updated', this.getStatus())

    // 2. Notifier les pairs qu'on prend le relais (en arrière-plan)
    for (const peer of this.peers) {
      try {
        const url = `http://${peer.address}:${peer.port}/api/cluster/takeover`
        axios.post(url, { newMaster: 'me' }, { timeout: 3000 }).catch(() => {})
      } catch (e) {}
    }
  }

  async release() {
    if (this.role === 'master') {
      dbg(`[cluster] 🏳️ Libération du rôle de Maître`)
      this.role = 'slave'
      this.emit('role-changed', 'slave')
    }
  }

  async broadcastSync(data) {
    if (this.role !== 'master') return

    for (const peer of this.peers) {
      try {
        const url = `http://${peer.address}:${peer.port}/api/cluster/sync`
        await axios.post(url, data, { timeout: 2000 })
      } catch (e) {}
    }
  }

  async broadcastPlist(name, content) {
    if (this.role !== 'master') return

    dbg(`[cluster] 📤 Diffusion du certificat ${name} au cluster...`)
    for (const peer of this.peers) {
      try {
        const url = `http://${peer.address}:${peer.port}/api/cluster/sync-plist`
        await axios.post(url, { name, content }, { timeout: 5000 })
      } catch (e) {}
    }
  }

  getStatus() {
    const os = require('os')
    return {
      role: this.role,
      mode: settings.get('clusterMode'),
      serverName: settings.get('serverName') || os.hostname(),
      peers: this.peerStatus || this.peers,
      currentMaster: this.currentMaster,
      lastMasterSeen: this.lastMasterSeen,
      tunnelActive: require('../tunneld-manager').getRsdAddress() !== null
    }
  }

  destroy() {
    this._isQuitting = true
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval)
  }
}

module.exports = new ClusterManager()
