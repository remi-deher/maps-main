/**
 * storage-service.js — Abstraction sur localStorage pour la persistance
 */
;(function () {
  'use strict'

  const KEYS = {
    HISTORY: 'gps_history',
    FAVORITES: 'gps_favorites',
    THEME: 'gps_theme'
  }

  function get(key, defaultValue = []) {
    try {
      const data = localStorage.getItem(key)
      return data ? JSON.parse(data) : defaultValue
    } catch (_) {
      return defaultValue
    }
  }

  function save(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data))
    } catch (e) {
      console.error(`[StorageService] Erreur sauvegarde ${key}:`, e.message)
    }
  }

  window.StorageService = {
    getHistory: () => get(KEYS.HISTORY),
    saveHistory: (data) => save(KEYS.HISTORY, data),
    getFavorites: () => get(KEYS.FAVORITES),
    saveFavorites: (data) => save(KEYS.FAVORITES, data),
    getTheme: () => get(KEYS.THEME, 'dark'),
    saveTheme: (theme) => save(KEYS.THEME, theme)
  }

})()
