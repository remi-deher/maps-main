/**
 * log-window.js — Gère la fenêtre flottante des journaux (logs).
 */
;(function () {
  'use strict'

  const logWindow = document.getElementById('log-window')
  const btnOpen   = document.getElementById('btn-open-logs')
  const btnClose  = document.getElementById('btn-close-logs')
  const btnClear  = document.getElementById('btn-clear-log')
  const logBox    = document.getElementById('log')

  function show() {
    logWindow.style.display = 'flex'
  }

  function hide() {
    logWindow.style.display = 'none'
  }

  function clear() {
    if (logBox) logBox.innerHTML = ''
    window.UIModule?.showToast('Journal effacé', 'info')
  }

  // Événements
  if (btnOpen) btnOpen.addEventListener('click', show)
  if (btnClose) btnClose.addEventListener('click', hide)
  if (btnClear) btnClear.addEventListener('click', clear)

  // Drag & Drop optionnel pour la fenêtre de logs ? 
  // (On fera simple pour l'instant : position fixe en bas à droite)

  window.LogWindowModule = {
    show,
    hide,
    clear
  }
})()
