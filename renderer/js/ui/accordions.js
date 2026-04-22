/**
 * accordions.js — Gère le dépliage/repliage des sections dans la sidebar.
 */
;(function () {
  'use strict'

  function initAccordions() {
    const accordions = document.querySelectorAll('.side-accordion')

    accordions.forEach(acc => {
      const header = acc.querySelector('.accordion-header')
      if (!header) return

      header.addEventListener('click', () => {
        const isCollapsed = acc.classList.contains('collapsed')
        
        // Optionnel : Refermer les autres si on veut un comportement d'accordéon pur
        // document.querySelectorAll('.side-accordion').forEach(a => a.classList.add('collapsed'))

        if (isCollapsed) {
          acc.classList.remove('collapsed')
        } else {
          acc.classList.add('collapsed')
        }
      })
    })
  }

  // Initialisation au chargement
  window.addEventListener('DOMContentLoaded', initAccordions)
  if (document.readyState !== 'loading') initAccordions()

})()
