/**
 * monitor.js — Gestion des badges de statut et de la boîte de simulation active
 */
/* global AppState, L */
;(function () {
  'use strict'

  let minimap = null
  let minimapMarker = null

  function initMinimap() {
    minimap = L.map('active-sim-map', {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(minimap)
  }

  function setActiveSim(lat, lon, name, latencyMs) {
    if (window.AppState) window.AppState.activeSim = { lat, lon, name }
    
    // Pour l'affichage dans la sidebar
    const block = document.getElementById('active-sim-block')
    if (block) block.style.display = 'block'
    
    document.getElementById('active-sim-name').textContent   = name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`
    document.getElementById('active-sim-coords').textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`

    const latElem = document.getElementById('active-sim-latency')
    if (latElem) {
      latElem.textContent = latencyMs ? `Latence: ${(latencyMs / 1000).toFixed(1)}s` : ''
    }

    // On notifie la nouvelle Status Pill
    window.dispatchEvent(new CustomEvent('sim-status', {
      detail: { active: true, name: name || 'Position' }
    }))
  }

  function clearActiveSim() {
    if (window.AppState) window.AppState.activeSim = null
    const block = document.getElementById('active-sim-block')
    if (block) block.style.display = 'none'

    window.dispatchEvent(new CustomEvent('sim-status', {
      detail: { active: false }
    }))
  }

  function setTunnelBadge(state, label) {
    // On notifie la nouvelle Status Pill
    window.dispatchEvent(new CustomEvent('tunnel-status', {
      detail: { state: (state === 'active' || state === 'ready') ? 'active' : 'starting', message: label }
    }))
  }

  if (!window.UIModule) window.UIModule = {}
  window.UIModule.setActiveSim   = setActiveSim
  window.UIModule.clearActiveSim = clearActiveSim
  window.UIModule.setTunnelBadge = setTunnelBadge

})()
