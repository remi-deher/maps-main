/**
 * theme.js — Gestion du thème sombre/clair
 */
;(function () {
  'use strict'

  const themeToggle = document.getElementById('theme-toggle')
  if (!themeToggle) return

  // Initialisation via StorageService
  const currentTheme = window.StorageService ? window.StorageService.getTheme() : 'dark'
  if (currentTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
    themeToggle.textContent = '🌙'
  } else {
    themeToggle.textContent = '☀️'
  }

  // Listener
  themeToggle.addEventListener('click', () => {
    let theme = document.documentElement.getAttribute('data-theme')
    if (theme === 'light') {
      document.documentElement.removeAttribute('data-theme')
      window.StorageService?.saveTheme('dark')
      themeToggle.textContent = '☀️'
    } else {
      document.documentElement.setAttribute('data-theme', 'light')
      window.StorageService?.saveTheme('light')
      themeToggle.textContent = '🌙'
    }
  })

})()
