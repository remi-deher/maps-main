/**
 * map.js — Architecture Multi-Moteur (Leaflet / Google Maps)
 * 
 * Ce module gère l'affichage de la carte et fournit une interface unifiée
 * pour placer des marqueurs et gérer les événements de clic.
 */

/* global L, AppState, google */

;(function () {
  'use strict'

  let activeEngine = null
  let currentProvider = 'leaflet'

  // ─── Reverse Geocoding (Nominatim) ──────────────────────────────────────────

  async function reverseGeocode(lat, lon) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`)
      const d = await r.json()
      if (!d.address) return d.display_name?.split(',').slice(0, 2).join(',').trim() || null
      const addr = d.address
      const main = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || addr.city_district || ''
      const city = addr.city || addr.town || addr.village || ''
      if (main && city) return `${main}, ${city}`
      return d.display_name?.split(',').slice(0, 2).join(',').trim() || null
    } catch { return null }
  }

  // ─── Moteur Leaflet ─────────────────────────────────────────────────────────

  const LeafletEngine = {
    map: null,
    marker: null,

    init() {
      const cont = document.getElementById('map')
      cont.innerHTML = ''
      this.map = L.map('map').setView([46.8, 8.2], 6)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(this.map)

      this.map.on('click', (e) => onMapClick(e.latlng.lat, e.latlng.lng))
    },

    placeMarker(lat, lon) {
      if (this.marker) {
        this.marker.setLatLng([lat, lon])
      } else {
        const icon = L.icon({
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          iconSize: [25, 41], iconAnchor: [12, 41]
        })
        this.marker = L.marker([lat, lon], { icon, draggable: true }).addTo(this.map)
        this.marker.on('dragend', (e) => {
          const p = e.target.getLatLng()
          onMarkerMoved(p.lat, p.lng)
        })
      }
      this.map.setView([lat, lon], this.map.getZoom())
    },

    destroy() {
      if (this.map) {
        this.map.remove()
        this.map = null
        this.marker = null
      }
    }
  }

  // ─── Moteur Google Maps ─────────────────────────────────────────────────────

  const GoogleEngine = {
    map: null,
    marker: null,

    async init(apiKey) {
      await this._loadScript(apiKey)
      const cont = document.getElementById('map')
      cont.innerHTML = ''
      this.map = new google.maps.Map(cont, {
        center: { lat: 46.8, lng: 8.2 },
        zoom: 6,
        disableDefaultUI: false,
        mapId: 'DEMO_MAP_ID' // Optionnel
      })

      this.map.addListener('click', (e) => onMapClick(e.latLng.lat(), e.latLng.lng()))
    },

    _loadScript(key) {
      return new Promise((resolve) => {
        if (window.google && window.google.maps) return resolve()
        const script = document.createElement('script')
        script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=initGMap`
        script.async = true
        window.initGMap = resolve
        document.head.appendChild(script)
      })
    },

    placeMarker(lat, lon) {
      const pos = { lat, lng: lon }
      if (this.marker) {
        this.marker.setPosition(pos)
      } else {
        this.marker = new google.maps.Marker({
          position: pos,
          map: this.map,
          draggable: true
        })
        this.marker.addListener('dragend', () => {
          const p = this.marker.getPosition()
          onMarkerMoved(p.lat(), p.lng())
        })
      }
      this.map.setCenter(pos)
    },

    destroy() {
      const cont = document.getElementById('map')
      if (cont) cont.innerHTML = ''
      this.map = null
      this.marker = null
    }
  }

  // ─── Logique Commune ─────────────────────────────────────────────────────────

  async function onMapClick(lat, lon) {
    placeMarker(lat, lon)
    const name = await reverseGeocode(lat, lon)
    placeMarker(lat, lon, name)
  }

  async function onMarkerMoved(lat, lon) {
    placeMarker(lat, lon) // Update coords
    const name = await reverseGeocode(lat, lon)
    placeMarker(lat, lon, name)
  }

  function placeMarker(lat, lon, name) {
    if (!window.AppState) return

    AppState.selectedLat = parseFloat(parseFloat(lat).toFixed(6))
    AppState.selectedLon = parseFloat(parseFloat(lon).toFixed(6))
    AppState.selectedName = name || null

    if (activeEngine) activeEngine.placeMarker(AppState.selectedLat, AppState.selectedLon)

    // Mise à jour de la Sidebar (Active Sim Section)
    const block = document.getElementById('active-sim-block')
    if (block) {
      block.style.display = 'block'
      const nameEl = document.getElementById('active-sim-name')
      const coordsEl = document.getElementById('active-sim-coords')
      if (nameEl) nameEl.textContent = name || 'Position sélectionnée'
      if (coordsEl) coordsEl.textContent = `${AppState.selectedLat}, ${AppState.selectedLon}`
    }

    if (btnTeleport) btnTeleport.disabled = false
    if (btnFav) btnFav.disabled = false

    // Gestion de la pilule d'action "Allez ici"
    const actionPill = document.getElementById('action-pill')
    if (actionPill) {
      document.getElementById('action-name').textContent = name || 'Lieu sélectionné'
      document.getElementById('action-coords').textContent = `${AppState.selectedLat}, ${AppState.selectedLon}`
      actionPill.style.display = 'flex'
    }
  }

  // ─── Initialisation & Switch ────────────────────────────────────────────────

  async function switchEngine(provider, key = null) {
    if (activeEngine) activeEngine.destroy()
    
    currentProvider = provider
    if (provider === 'google' && key) {
      activeEngine = GoogleEngine
      await activeEngine.init(key)
    } else {
      activeEngine = LeafletEngine
      activeEngine.init()
    }

    // Restaurer la position si elle existe
    if (AppState.selectedLat) {
      activeEngine.placeMarker(AppState.selectedLat, AppState.selectedLon)
    }
  }

  // Ecoute du changement de paramètres
  window.addEventListener('map-provider-changed', (e) => {
    switchEngine(e.detail.provider, e.detail.key)
  })

  // Init au démarrage
  window.addEventListener('DOMContentLoaded', async () => {
    const s = await window.gps.getSettings()
    switchEngine(s.mapProvider || 'leaflet', s.googleMapsKey)
  })

  // Export
  window.MapModule = { 
    placeMarker, 
    reverseGeocode, 
    switchEngine,
    getMap: () => activeEngine.map
  }

})()
