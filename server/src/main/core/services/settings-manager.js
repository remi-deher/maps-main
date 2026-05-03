'use strict'

const fs = require('fs')
const { getStoragePath } = require('../../platform/PathResolver')

/**
 * SettingsManager (V2) - Gère la persistance de la configuration.
 */
class SettingsManager {
  constructor() {
    this.path = getStoragePath('settings.json')
    this.settings = this._load()
  }

  get(key) {
    return key ? this.settings[key] : this.settings
  }

  save(newSettings) {
    this.settings = { ...this.settings, ...newSettings }
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.settings, null, 2), 'utf8')
      return true
    } catch (e) {
      console.error('[SettingsManager] Erreur écriture:', e.message)
      return false
    }
  }

  _load() {
    const defaults = { 
      wifiIp: '', 
      wifiPort: '', 
      companionPort: 8080,
      connectionMode: 'both',
      operationMode: 'hybrid', 
      isEveilMode: true,       
      preferredDriver: 'pymobiledevice', 
      fallbackEnabled: true,
      serverIp: null,
      preferredIp: '',
      favorites: [],
      recentHistory: [],
      clusterMode: 'off', 
      clusterNodes: [],    
      serverName: '',      
      manualTunnelMode: false, 
      networkOnlyMode: false,  
      manualTunnelAddress: '',
      logLevel: 'info',
      eveilInterval: 5,
      lastActiveLocation: null,
      savedTrips: []
    }

    try {
      if (fs.existsSync(this.path)) {
        const data = JSON.parse(fs.readFileSync(this.path, 'utf8'))
        return { ...defaults, ...data }
      }
    } catch (e) {
      console.error('[SettingsManager] Erreur lecture:', e.message)
    }
    return defaults
  }
}

module.exports = new SettingsManager()
