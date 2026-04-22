/**
 * theme.js — Gestion du thème sombre/clair
 */
;(function () {
  'use strict'

  const themeToggle = document.getElementById('btn-theme-cycle')
  if (!themeToggle) return

  // Initialisation via StorageService
  const currentTheme = window.StorageService ? window.StorageService.getTheme() : 'dark'
  document.body.setAttribute('data-theme', currentTheme)

  function updateIcon(theme) {
    themeToggle.textContent = theme === 'light' ? '🌙' : '☀️'
  }
  updateIcon(currentTheme)

  // Listener
  themeToggle.addEventListener('click', () => {
    let theme = document.body.getAttribute('data-theme')
    let nextTheme = (theme === 'light') ? 'dark' : 'light'
    
    document.body.setAttribute('data-theme', nextTheme)
    window.StorageService?.saveTheme(nextTheme)
    updateIcon(nextTheme)
  })

})()
