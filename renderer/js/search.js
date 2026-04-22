/**
 * search.js — Recherche d'adresse via Nominatim (OpenStreetMap)
 *
 * Dépendances (chargées avant ce script) :
 *   - map.js → window.MapModule.placeMarker, window.MapModule.map
 */

/* global MapModule */

;(function () {
  'use strict'

  const searchInput = document.getElementById('search-input')
  const searchResults = document.getElementById('search-results')
  let searchTimer = null

  // ─── Recherche Nominatim ──────────────────────────────────────────────────────

  async function doSearch(q) {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6`
      )
      const data = await r.json()

      if (!data.length) {
        searchResults.innerHTML = '<div class="search-result-item"><span class="place-name">Aucun résultat</span></div>'
        searchResults.classList.add('visible')
        return
      }

      searchResults.innerHTML = data.map((r) => {
        const parts = r.display_name.split(',')
        const name = parts.slice(0, 2).join(',').trim()
        const sub  = parts.slice(2, 4).join(',').trim()
        return `<div class="search-result-item" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${name}">
          <div class="place-name">${name}</div>
          <div class="place-sub">${sub}</div>
        </div>`
      }).join('')

      searchResults.classList.add('visible')

      searchResults.querySelectorAll('.search-result-item').forEach((el) => {
        el.addEventListener('click', () => {
          const lat = parseFloat(el.dataset.lat)
          const lon = parseFloat(el.dataset.lon)
          MapModule.placeMarker(lat, lon, el.dataset.name)
          MapModule.map.setView([lat, lon], 13)
          searchInput.value = el.dataset.name
          searchResults.classList.remove('visible')
        })
      })
    } catch {
      searchResults.innerHTML = '<div class="search-result-item"><span class="place-name">Erreur réseau</span></div>'
      searchResults.classList.add('visible')
    }
  }

  // ─── Listeners ───────────────────────────────────────────────────────────────

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer)
    const q = searchInput.value.trim()
    if (q.length < 3) { searchResults.classList.remove('visible'); return }
    searchTimer = setTimeout(() => doSearch(q), 400)
  })

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchResults.classList.remove('visible')
      searchInput.blur()
    }
  })

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#omnibar')) searchResults.classList.remove('visible')
  })
})()
