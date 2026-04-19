/**
 * map.js — Carte Leaflet, marker, géocodage inversé
 *
 * Dépendances (chargées avant ce script) :
 *   - Leaflet (CDN)
 *   - state.js  → window.AppState
 *
 * Expose sur window :
 *   - window.MapModule.placeMarker(lat, lon, name)
 *   - window.MapModule.map  (instance L.Map)
 */

/* global L, AppState */

;(function () {
  'use strict'

  // ─── Init carte ──────────────────────────────────────────────────────────────

  const map = L.map('map').setView([46.8, 8.2], 6)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map)

  const markerIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
  })

  // ─── Géocodage inversé ───────────────────────────────────────────────────────

  async function reverseGeocode(lat, lon) {
    try {
      // On demande des détails pour avoir ville/quartier si besoin
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`)
      const d = await r.json()
      if (!d.address) return d.display_name?.split(',').slice(0, 2).join(',').trim() || null
      
      // Essayer d'extraire des infos plus "humaines"
      const addr = d.address
      const main = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || addr.city_district || ''
      const city = addr.city || addr.town || addr.village || ''
      
      if (main && city) return `${main}, ${city}`
      return d.display_name?.split(',').slice(0, 2).join(',').trim() || null
    } catch { return null }
  }

  // ─── Placement du marker ─────────────────────────────────────────────────────

  function placeMarker(lat, lon, name) {
    AppState.selectedLat = parseFloat(parseFloat(lat).toFixed(6))
    AppState.selectedLon = parseFloat(parseFloat(lon).toFixed(6))
    AppState.selectedName = name || null

    if (AppState.marker) {
      AppState.marker.setLatLng([AppState.selectedLat, AppState.selectedLon])
    } else {
      AppState.marker = L.marker(
        [AppState.selectedLat, AppState.selectedLon],
        { icon: markerIcon, draggable: true }
      ).addTo(map)

      AppState.marker.on('dragend', async (e) => {
        const p = e.target.getLatLng()
        placeMarker(p.lat, p.lng) // State loading
        const n = await reverseGeocode(p.lat, p.lng)
        placeMarker(p.lat, p.lng, n)
      })
    }

    document.getElementById('disp-lat').textContent = AppState.selectedLat
    document.getElementById('disp-lon').textContent = AppState.selectedLon
    
    const nameElem = document.getElementById('disp-name')
    if (name) {
      nameElem.textContent = name
      nameElem.classList.remove('loading')
    } else if (name === null) {
      nameElem.textContent = '—'
      nameElem.classList.remove('loading')
    } else {
      // Initial click or drag -> loading search
      nameElem.textContent = 'Recherche d\'adresse...'
      nameElem.classList.add('loading')
    }

    document.getElementById('btn-teleport').disabled = false
    document.getElementById('btn-favorite').disabled = false
  }

  // ─── Clic sur la carte ───────────────────────────────────────────────────────

  map.on('click', async (e) => {
    placeMarker(e.latlng.lat, e.latlng.lng) // Immédiat (Affiche coords + Recherche...)
    const name = await reverseGeocode(e.latlng.lat, e.latlng.lng)
    placeMarker(e.latlng.lat, e.latlng.lng, name)
  })

  // ─── Export ──────────────────────────────────────────────────────────────────

  window.MapModule = { map, placeMarker, reverseGeocode }
})()
