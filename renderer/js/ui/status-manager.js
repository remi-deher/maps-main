/**
 * status-manager.js — Gère la "Status Pill" flottante en bas de l'écran.
 */
;(function () {
  'use strict'

  const pill      = document.getElementById('status-pill')
  const textEl    = document.getElementById('status-text')
  const detailEl  = document.getElementById('status-details')

  function updateStatus(status, text, details = '') {
    if (!pill) return

    // On retire les classes d'état existantes
    pill.classList.remove('starting', 'active', 'error', 'none')
    pill.classList.add(status)

    if (textEl) textEl.textContent = text
    if (detailEl) detailEl.textContent = details

    // Petite animation de feedback
    pill.style.transform = 'scale(1.05)'
    setTimeout(() => { pill.style.transform = '' }, 200)
  }

  // Écoute des événements système pour mettre à jour la pilule
  window.addEventListener('tunnel-status', (e) => {
    const { state, message } = e.detail || {}
    updateStatus(state, message, 'Connexion iPhone')
  })

  window.addEventListener('sim-status', (e) => {
    const { active, name } = e.detail || {}
    if (active) {
      updateStatus('active', `Simulation active : ${name}`, 'En cours d\'injection')
    }
  })

  // Export
  window.StatusModule = {
    update: updateStatus
  }

})()
