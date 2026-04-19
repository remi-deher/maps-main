/**
 * notifier.js — Gestion des Toasts (notifications temporaires)
 */
;(function () {
  'use strict'

  let toastTimer = null

  function showToast(msg, type = '') {
    const t = document.getElementById('toast')
    if (!t) return
    
    t.textContent = msg
    t.className   = `show ${type}`
    
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { t.className = '' }, 3000)
  }

  if (!window.UIModule) window.UIModule = {}
  window.UIModule.showToast = showToast

})()
