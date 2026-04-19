'use strict'

const { app } = require('electron')
const path = require('path')
const fs   = require('fs')

/**
 * Gère la persistance de la configuration sur disque
 */
class SettingsManager {
  constructor() {
    this.path = path.join(app.getPath('userData'), 'settings.json')
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
    try {
      if (fs.existsSync(this.path)) {
        return JSON.parse(fs.readFileSync(this.path, 'utf8'))
      }
    } catch (e) {
      console.error('[SettingsManager] Erreur lecture:', e.message)
    }
    return { 
      wifiIp: '', 
      wifiPort: '', 
      connectionMode: 'both' // 'usb', 'wifi', 'both'
    }
  }
}

module.exports = new SettingsManager()
