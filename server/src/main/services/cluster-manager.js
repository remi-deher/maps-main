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
    this.peers = []
    this.role = 'slave' // 'master' | 'slave'
    this.currentMaster = null
    this.lastMasterSeen = 0
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
  }

  _startHeartbeat() {
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval)
    this._heartbeatInterval = setInterval(async () => {
      if (this._isQuitting) return

      const mode = settings.get('clusterMode')
      if (mode === 'off') return

      await this._checkPeers()
      
      // Logique de Failover Automatique (30s)
      if (mode === 'auto' && this.role === 'slave') {
        const now = Date.now()
        if (this.currentMaster === null || (now - this.lastMasterSeen > 30000)) {
          dbg(`[cluster] ⚠️ Maître absent depuis > 30s. Tentative de prise de contrôle automatique...`)
          await this.takeover()
        }
      }
    }, 10000) // Vérification toutes les 10s
  }

  async _checkPeers() {
    let masterFound = false
    
    for (const peer of this.peers) {
      try {
        const url = `http://${peer.address}:${peer.port}/api/cluster/ping`
        const res = await axios.get(url, { timeout: 3000 })
        
        if (res.data && res.data.role === 'master') {
          this.currentMaster = peer.address
          this.lastMasterSeen = Date.now()
          masterFound = true
        }
      } catch (e) {
        // Peer offline, ignoré
      }
    }

    if (!masterFound) {
      this.currentMaster = null
    }
  }

  async takeover() {
    dbg(`[cluster] 👑 Prise de contrôle du cluster...`)
    
    // 1. Notifier les pairs qu'on prend le relais
    for (const peer of this.peers) {
      try {
        const url = `http://${peer.address}:${peer.port}/api/cluster/takeover`
        await axios.post(url, { newMaster: 'me' }, { timeout: 3000 })
      } catch (e) {}
    }

    // 2. Changer de rôle localement
    this.role = 'master'
    this.currentMaster = 'me'
    this.lastMasterSeen = Date.now()
    this.emit('role-changed', 'master')
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

  getStatus() {
    return {
      role: this.role,
      mode: settings.get('clusterMode'),
      peers: this.peers,
      currentMaster: this.currentMaster,
      lastMasterSeen: this.lastMasterSeen
    }
  }

  destroy() {
    this._isQuitting = true
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval)
  }
}

module.exports = new ClusterManager()
