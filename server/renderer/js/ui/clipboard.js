/**
 * clipboard.js — Gestion de la copie des coordonnées
 */
/* global AppState */
;(function () {
  'use strict'

  const dispLat = document.getElementById('disp-lat')
  const dispLon = document.getElementById('disp-lon')

  if (dispLat) {
    dispLat.addEventListener('click', () => {
      if (!window.AppState || window.AppState.selectedLat === null) return
      navigator.clipboard.writeText(String(window.AppState.selectedLat))
      if (window.UIModule && window.UIModule.showToast) {
        window.UIModule.showToast('Latitude copiée', 'info')
      }
    })
  }

  if (dispLon) {
    dispLon.addEventListener('click', () => {
      if (!window.AppState || window.AppState.selectedLon === null) return
      navigator.clipboard.writeText(String(window.AppState.selectedLon))
      if (window.UIModule && window.UIModule.showToast) {
        window.UIModule.showToast('Longitude copiée', 'info')
      }
    })
  }

})()
