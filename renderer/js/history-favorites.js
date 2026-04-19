/**
 * history-favorites.js — Historique, favoris, modal de nommage
 *
 * Dépendances (chargées avant ce script) :
 *   - map.js → window.MapModule.placeMarker, window.MapModule.map
 *
 * Expose sur window :
 *   - window.HistoryFavModule.addToHistory(lat, lon, name)
 *   - window.HistoryFavModule.renderHistory()
 *   - window.HistoryFavModule.renderFavorites()
 *   - window.HistoryFavModule.openModal(lat, lon, defaultName)
 */

/* global MapModule */

;(function () {
  'use strict'

  // ─── Persistance via StorageService ─────────────────────────────────────────

  let history_  = window.StorageService ? window.StorageService.getHistory()  : []
  let favorites = window.StorageService ? window.StorageService.getFavorites() : []

  const saveHistory   = () => window.StorageService?.saveHistory(history_)
  const saveFavorites = () => window.StorageService?.saveFavorites(favorites)

  // ─── Historique ──────────────────────────────────────────────────────────────

  function addToHistory(lat, lon, name) {
    history_ = history_.filter(h => !(Math.abs(h.lat - lat) < 0.0001 && Math.abs(h.lon - lon) < 0.0001))
    history_.unshift({ lat, lon, name: name || `${lat}, ${lon}` })
    if (history_.length > 30) history_.pop()
    saveHistory()
    renderHistory()
  }

  function renderHistory() {
    const container = document.getElementById('tab-history')
    container.querySelectorAll('.list-item').forEach(el => el.remove())
    const empty = document.getElementById('history-empty')
    if (!history_.length) { empty.style.display = 'block'; return }
    empty.style.display = 'none'
    history_.forEach((h, i) => container.appendChild(makeListItem(h, i, 'history')))
  }

  function goBackInHistory() {
    if (history_.length === 0) return
    const { activeSim } = window.AppState
    let target = history_[0]
    if (activeSim && history_.length > 1) {
      const h0 = history_[0]
      if (Math.abs(h0.lat - activeSim.lat) < 0.0001 && Math.abs(h0.lon - activeSim.lon) < 0.0001) {
        target = history_[1]
      }
    }
    
    window.MapModule.placeMarker(target.lat, target.lon, target.name)
    window.MapModule.map.setView([target.lat, target.lon], 13)
    window.UIModule?.showToast('Position précédente chargée (Entrée pour simuler)', 'info')
  }

  // ─── Favoris ─────────────────────────────────────────────────────────────────

  let favFilter = ''

  document.getElementById('fav-search').addEventListener('input', (e) => {
    favFilter = e.target.value.trim().toLowerCase()
    renderFavorites()
  })

  function addToFavorites(lat, lon, name) {
    favorites = favorites.filter(f => !(Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001))
    favorites.unshift({ lat, lon, name })
    saveFavorites()
    renderFavorites()
  }

  function highlight(text, query) {
    if (!query) return text
    const idx = text.toLowerCase().indexOf(query)
    if (idx === -1) return text
    return (
      text.slice(0, idx) +
      '<mark>' + text.slice(idx, idx + query.length) + '</mark>' +
      text.slice(idx + query.length)
    )
  }

  function renderFavorites() {
    const container = document.getElementById('tab-favorites')
    container.querySelectorAll('.list-item').forEach(el => el.remove())
    const empty = document.getElementById('favorites-empty')

    const filtered = favFilter
      ? favorites.filter(f => f.name.toLowerCase().includes(favFilter))
      : favorites

    if (!filtered.length) {
      empty.textContent = favFilter ? 'Aucun résultat' : 'Aucun favori'
      empty.style.display = 'block'
      return
    }

    empty.style.display = 'none'
    filtered.forEach((f) => {
      const realIndex = favorites.indexOf(f)
      container.appendChild(makeListItem(f, realIndex, 'favorite', favFilter))
    })
  }

  // ─── Élément de liste générique ──────────────────────────────────────────────

  function makeListItem(item, index, type, filterQuery = '') {
    const el = document.createElement('div')
    el.className = 'list-item'
    const isFav = type === 'favorite'
    const displayName = isFav ? highlight(item.name, filterQuery) : item.name

    el.innerHTML = `
      <div class="list-item-info">
        <div class="list-item-name">${displayName}</div>
        <div class="list-item-coords">${parseFloat(item.lat).toFixed(4)}, ${parseFloat(item.lon).toFixed(4)}</div>
      </div>
      <div class="list-item-actions">
        ${!isFav ? '<button class="icon-btn fav-btn" title="Ajouter aux favoris">⭐</button>' : ''}
        <button class="icon-btn del-btn" title="Supprimer">🗑️</button>
      </div>`

    el.querySelector('.list-item-info').addEventListener('click', () => {
      MapModule.placeMarker(item.lat, item.lon, item.name)
      MapModule.map.setView([item.lat, item.lon], 13)
    })

    if (!isFav) {
      el.querySelector('.fav-btn').addEventListener('click', (e) => {
        e.stopPropagation()
        openModal(item.lat, item.lon, item.name)
      })
    }

    el.querySelector('.del-btn').addEventListener('click', (e) => {
      e.stopPropagation()
      if (isFav) { favorites.splice(index, 1); saveFavorites(); renderFavorites() }
      else        { history_.splice(index, 1);  saveHistory();   renderHistory() }
    })

    return el
  }

  // ─── Modal de nommage ────────────────────────────────────────────────────────

  function openModal(lat, lon, defaultName) {
    const overlay = document.getElementById('modal-overlay')
    const input   = document.getElementById('modal-input')
    input.value   = defaultName
    overlay.classList.add('visible')
    setTimeout(() => { input.focus(); input.select() }, 50)

    document.getElementById('modal-confirm').onclick = () => {
      const name = input.value.trim() || `${lat}, ${lon}`
      addToFavorites(lat, lon, name)
      overlay.classList.remove('visible')
      window.UIModule?.showToast('Favori ajouté !', 'success')
    }
    document.getElementById('modal-cancel').onclick = () => overlay.classList.remove('visible')
    input.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('modal-confirm').click() }
  }

  // Bouton "Ajouter aux favoris" dans le panneau
  document.getElementById('btn-favorite').addEventListener('click', () => {
    const { selectedLat, selectedLon, selectedName } = window.AppState
    if (selectedLat === null) return
    openModal(selectedLat, selectedLon, selectedName || '')
  })

  // ─── Export ──────────────────────────────────────────────────────────────────

  window.HistoryFavModule = { addToHistory, renderHistory, renderFavorites, openModal, goBackInHistory }
})()
