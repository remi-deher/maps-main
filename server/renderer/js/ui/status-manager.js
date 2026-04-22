/**
 * status-manager.js — Gère la "Status Pill" flottante en bas de l'écran.
 */
;(function () {
  'use strict'

  const pill      = document.getElementById('status-pill')
  const textEl    = document.getElementById('status-text')
  const detailEl  = document.getElementById('status-details')

  let tunnelState = { state: 'starting', message: 'Initialisation...', type: null }
  let companionState = { state: 'stopped', message: 'Application non connectée' }

  function refreshUI() {
    if (!pill) return

    // Priorité au tunnel : s'il est arrêté, on affiche l'erreur tunnel
    if (tunnelState.state === 'stopped' || tunnelState.state === 'error') {
      pill.className = 'glass-panel error'
      textEl.textContent = tunnelState.message
      detailEl.textContent = 'Vérifiez la connexion USB/WiFi'
    } 
    // Si le tunnel est prêt, on regarde l'application
    else if (tunnelState.state === 'ready') {
      const typeLabel = tunnelState.type ? ` [${tunnelState.type}]` : ''
      
      if (companionState.state === 'ready') {
        pill.className = 'glass-panel active'
        textEl.textContent = `iPhone prêt${typeLabel}`
        detailEl.textContent = companionState.message
      } else {
        pill.className = 'glass-panel starting'
        textEl.textContent = `iPhone détecté${typeLabel}`
        detailEl.textContent = companionState.message || 'Lancer l\'application GPS Mock'
      }
    }
    else {
      pill.className = 'glass-panel starting'
      textEl.textContent = tunnelState.message
      detailEl.textContent = 'Recherche en cours...'
    }

    // Animation de feedback
    pill.style.transform = 'scale(1.02)'
    setTimeout(() => { pill.style.transform = '' }, 200)
  }

  // Écoute des événements système
  window.addEventListener('tunnel-status', (e) => {
    tunnelState = { ...tunnelState, ...e.detail }
    refreshUI()
  })

  window.addEventListener('companion-status', (e) => {
    companionState = { ...companionState, ...e.detail }
    refreshUI()
  })

  window.addEventListener('sim-status', (e) => {
    const { active, name } = e.detail || {}
    if (active) {
      // On peut ajouter une indication de simulation en cours
      detailEl.textContent = `Simulation : ${name}`
    }
  })

  // Export
  window.StatusModule = {
    update: updateStatus
  }

})()
