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
    
    const box = document.getElementById('active-sim-box')
    if (!box) return

    box.classList.add('visible')
    document.getElementById('active-sim-name').textContent   = name || `${lat}, ${lon}`
    document.getElementById('active-sim-coords').textContent = `${lat}, ${lon}`
    document.getElementById('sim-badge').classList.add('active')

    const latElem = document.getElementById('active-sim-latency')
    if (latElem) {
      latElem.textContent = latencyMs ? `Latence: ${(latencyMs / 1000).toFixed(1)}s` : ''
    }

    const mapDiv = document.getElementById('active-sim-map')
    if (mapDiv) {
      mapDiv.style.display = 'block'
      if (!minimap) initMinimap()
      minimap.invalidateSize()
      minimap.setView([lat, lon], 14)

      const redIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        shadowSize: [41, 41]
      })

      if (minimapMarker) {
        minimapMarker.setLatLng([lat, lon])
      } else {
        minimapMarker = L.marker([lat, lon], {icon: redIcon}).addTo(minimap)
      }
    }
  }

  function clearActiveSim() {
    if (window.AppState) window.AppState.activeSim = null
    const box = document.getElementById('active-sim-box')
    if (box) box.classList.remove('visible')
    
    const badge = document.getElementById('sim-badge')
    if (badge) badge.classList.remove('active')
    
    const mapDiv = document.getElementById('active-sim-map')
    if (mapDiv) mapDiv.style.display = 'none'
  }

  function setTunnelBadge(state, label) {
    const badge = document.getElementById('tunnel-badge')
    if (!badge) return
    badge.className = state === 'ready' ? 'ready' : 'starting'
    document.getElementById('tunnel-text').textContent = label
  }

  if (!window.UIModule) window.UIModule = {}
  window.UIModule.setActiveSim   = setActiveSim
  window.UIModule.clearActiveSim = clearActiveSim
  window.UIModule.setTunnelBadge = setTunnelBadge

})()
