/**
 * logger.js — Gestion de la fenêtre de log visuelle
 */
;(function () {
  'use strict'

  function log(msg, type = '') {
    const box  = document.getElementById('log')
    if (!box) return
    
    const line = document.createElement('div')
    const time = new Date().toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    line.className   = `log-line log-${type}`
    line.textContent = `[${time}] ${msg}`
    box.appendChild(line)
    box.scrollTop = box.scrollHeight
  }

  // Listeners
  const clearBtn = document.getElementById('btn-clear-log')
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      document.getElementById('log').innerHTML = ''
    })
  }

  const openBtn = document.getElementById('btn-open-logs')
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (window.gps && window.gps.openLogs) window.gps.openLogs()
    })
  }

  // Export vers l'espace de nom global s'il existe déjà, sinon on verra via UIModule
  if (!window.UIModule) window.UIModule = {}
  window.UIModule.log = log

})()
