/**
 * tabs.js — Gestion du basculement d'onglets
 */
;(function () {
  'use strict'

  const tabsContainer = document.querySelector('.tabs')
  if (!tabsContainer) return

  tabsContainer.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab')
    if (!tab) return

    // Supprimer l'état actif de tous
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.list-panel').forEach(p => p.classList.remove('active'))

    // Activer l'onglet cliqué
    tab.classList.add('active')
    const targetPanel = document.getElementById(`tab-${tab.dataset.tab}`)
    if (targetPanel) targetPanel.classList.add('active')

    // Masquer la recherche favoris si on n'est pas sur l'onglet favoris
    const favSearchWrap = document.getElementById('fav-search-wrap')
    if (favSearchWrap) {
      favSearchWrap.classList.toggle('visible', tab.dataset.tab === 'favorites')
    }
  })

})()
