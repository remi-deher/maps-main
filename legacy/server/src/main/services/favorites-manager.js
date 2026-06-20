'use strict'

const { EventEmitter } = require('events')
const settings = require('./settings-manager')

/**
 * FavoritesManager - Gère la persistance et la logique métier des favoris
 * Source de vérité unique pour le serveur et les clients.
 */
class FavoritesManager extends EventEmitter {
  constructor() {
    super()
    this.favorites = settings.get('favorites') || []
    this.recentHistory = settings.get('recentHistory') || []
  }

  getFavorites() {
    return this.favorites
  }

  getHistory() {
    return this.recentHistory
  }

  addFavorite(fav) {
    // Éviter les doublons par coordonnées
    if (!this.favorites.some(f => Math.abs(f.lat - fav.lat) < 0.0001 && Math.abs(f.lon - fav.lon) < 0.0001)) {
      this.favorites = [fav, ...this.favorites]
      this._saveFavorites()
      return true
    }
    return false
  }

  removeFavorite(lat, lon) {
    const initialLength = this.favorites.length
    this.favorites = this.favorites.filter(f => Math.abs(f.lat - lat) > 0.0001 || Math.abs(f.lon - lon) > 0.0001)
    
    if (this.favorites.length !== initialLength) {
      this._saveFavorites()
      return true
    }
    return false
  }

  renameFavorite(lat, lon, newName) {
    let changed = false
    this.favorites = this.favorites.map(f => {
      if (Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001) {
        changed = true
        return { ...f, name: newName }
      }
      return f
    })

    if (changed) {
      this._saveFavorites()
    }
    return changed
  }

  addToHistory(entry) {
    // Éviter les doublons consécutifs
    if (this.recentHistory.length > 0 && this.recentHistory[0].name === entry.name) return false

    this.recentHistory = [entry, ...this.recentHistory].slice(0, 20)
    settings.save({ recentHistory: this.recentHistory })
    this.emit('history-updated', this.recentHistory)
    return true
  }

  _saveFavorites() {
    settings.save({ favorites: this.favorites })
    this.emit('favorites-updated', this.favorites)
  }
}

module.exports = new FavoritesManager()
