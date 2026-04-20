/**
 * sidebar-manager.js — Gère l'ouverture/fermeture de la sidebar flottante.
 */
;(function () {
  'use strict'

  const sidebar = document.getElementById('sidebar')
  const toggleBtn = document.getElementById('sidebar-toggle')
  
  let isOpen = true // Par défaut ouverte

  function toggleSidebar() {
    isOpen = !isOpen
    if (isOpen) {
      sidebar.classList.remove('hidden')
      toggleBtn.innerHTML = '☰'
    } else {
      sidebar.classList.add('hidden')
      toggleBtn.innerHTML = '📂' // Ou une autre icône
    }
    
    // On notifie la carte qu'elle doit se recentrer (si besoin)
    window.dispatchEvent(new Event('resize'))
  }

  // Initialisation
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleSidebar)
  }

  // Exposer si besoin
  window.SidebarModule = {
    toggle: toggleSidebar,
    isOpen: () => isOpen
  }
})()
