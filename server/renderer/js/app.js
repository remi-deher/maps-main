/**
 * app.js — Point d'entrée du renderer
 *
 * Dépendances (tous chargés avant ce script) :
 *   - state.js            → window.AppState
 *   - map.js              → window.MapModule
 *   - search.js           (auto-init)
 *   - history-favorites.js → window.HistoryFavModule
 *   - ui.js               → window.UIModule
 */

/* global AppState, MapModule, HistoryFavModule, UIModule */

;(function () {
  'use strict'

  const { log, showToast, setActiveSim, clearActiveSim, setTunnelBadge } = UIModule
  const { addToHistory, renderHistory, renderFavorites } = HistoryFavModule

  // ─── Bouton Téléporter ────────────────────────────────────────────────────────
  
  const teleportAction = async (btn) => {
    if (AppState.selectedLat === null) return
    
    const originalText = btn.textContent
    btn.disabled = true
    btn.textContent = '⏳ Envoi...'

    const label = AppState.selectedName || `${AppState.selectedLat}, ${AppState.selectedLon}`
    log(`Téléportation → ${label}`, 'info')

    const result = await window.gps.setLocation(AppState.selectedLat, AppState.selectedLon, AppState.selectedName)

    btn.disabled = false
    btn.textContent = originalText

    if (result.success) {
      log(`✅ ${label} (Latence: ${(result.latencyMs / 1000).toFixed(1)}s)`, 'ok')
      showToast('Position simulée !', 'success')
      addToHistory(AppState.selectedLat, AppState.selectedLon, AppState.selectedName)
      setActiveSim(AppState.selectedLat, AppState.selectedLon, AppState.selectedName, result.latencyMs)
      
      const actionPill = document.getElementById('action-pill')
      if (actionPill) actionPill.style.display = 'none'
    } else {
      log(`❌ ${result.error}`, 'err')
      showToast(result.error.includes('Timeout') ? 'Timeout — réessaie' : "Erreur lors de l'envoi", 'error')
    }
  }

  document.getElementById('btn-teleport').addEventListener('click', (e) => teleportAction(e.currentTarget))
  
  const btnGoHere = document.getElementById('btn-go-here')
  if (btnGoHere) btnGoHere.addEventListener('click', (e) => teleportAction(e.currentTarget))

  // ─── Bouton Réinitialiser ─────────────────────────────────────────────────────

  document.getElementById('btn-clear').addEventListener('click', async () => {
    const result = await window.gps.clearLocation()
    if (result.success) {
      log('Position réinitialisée', 'ok')
      showToast('Position réinitialisée', 'success')
      clearActiveSim()
      const actionPill = document.getElementById('action-pill')
      if (actionPill) actionPill.style.display = 'none'
    } else {
      log(`Erreur clear : ${result.error}`, 'err')
      showToast('Erreur lors de la réinitialisation', 'error')
    }
  })

  // ─── Statut tunnel (IPC depuis main) ─────────────────────────────────────────

  window.gps.onStatus(({ service, state, message, type }) => {
    if (service === 'sim-restart') {
      showToast('Simulation relancée automatiquement', 'info')
      log(`Simulation relancée : ${message}`, 'ok')
      return
    }
    
    log(message, state === 'ready' ? 'ok' : state === 'stopped' ? 'err' : 'info')
    
    if (service === 'tunneld') {
      setTunnelBadge(state, message, type)
    } else if (service === 'companion') {
      UIModule.setCompanionStatus(state, message)
    }

    if (state === 'stopped' && service === 'tunneld') clearActiveSim()
  })

  // Statut initial (au chargement de la page)
  window.gps.getStatus().then(({ tunnelReady, rsdAddress, rsdPort, connectionType }) => {
    if (tunnelReady) {
      setTunnelBadge('ready', 'iPhone connecté', connectionType)
      log(`Tunnel actif (${connectionType}) → ${rsdAddress}:${rsdPort}`, 'ok')
    }
  })

  // ─── Logs debug depuis le main process ───────────────────────────────────────

  window.gps.onDebug((msg) => log(msg, 'debug'))

  // ─── Raccourcis clavier ──────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    const act = document.activeElement
    if (act && (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA') && e.key !== 'Escape') {
      return
    }

    if (e.key === 'Escape') {
      if (act && act.tagName === 'INPUT') act.blur()
      document.getElementById('btn-clear').click()
    }
    else if (e.key === 'Enter') {
      const btn = document.getElementById('btn-teleport')
      if (!btn.disabled) btn.click()
    }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      document.getElementById('search-input').focus()
    }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (window.HistoryFavModule && window.HistoryFavModule.goBackInHistory) {
        window.HistoryFavModule.goBackInHistory()
      }
    }
  })

  // ─── Init ────────────────────────────────────────────────────────────────────

  renderHistory()
  renderFavorites()
  log('Interface chargée', 'info')
})()
