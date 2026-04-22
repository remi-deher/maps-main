/**
 * navigation.js — Gestionnaire central de la navigation (Sidebar, Modales).
 */
;(function () {
  'use strict'

  const overlay      = document.getElementById('sidebar-overlay')
  const btnToggle    = document.getElementById('sidebar-toggle')
  const btnClose     = document.getElementById('sidebar-close')
  const btnSettings  = document.getElementById('btn-open-settings')
  const btnQuickQr   = document.getElementById('btn-quick-qr')
  const modalCont    = document.getElementById('modal-container')
  const modalClose   = document.getElementById('modal-close')
  const modalBack    = document.getElementById('modal-backdrop')

  // ─── Sidebar Functions ───────────────────────────────────────────────────────

  function openSidebar() {
    overlay.classList.remove('sidebar-hidden')
  }

  function closeSidebar() {
    overlay.classList.add('sidebar-hidden')
  }

  // ─── Modal Functions ─────────────────────────────────────────────────────────

  function openModal() {
    const settings = document.getElementById('settings-modal')
    const favorite = document.getElementById('modal-overlay')
    
    modalCont.style.display = 'flex'
    if (settings) settings.style.display = 'flex'
    if (favorite) favorite.style.display = 'none'

    // On ferme la sidebar automatiquement si on ouvre les réglages
    closeSidebar()
  }

  function openQrModal() {
    openModal()
    // Déclencher l'affichage du QR code s'il n'est pas déjà là
    const btnShowQr = document.getElementById('btn-show-qr')
    const qrContainer = document.getElementById('companion-qr-container')
    if (btnShowQr && qrContainer && qrContainer.style.display !== 'block') {
      btnShowQr.click()
    }
  }

  function closeModal() {
    modalCont.style.display = 'none'
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────────

  if (btnToggle) btnToggle.addEventListener('click', openSidebar)
  if (btnClose)  btnClose.addEventListener('click', closeSidebar)
  
  if (btnSettings) btnSettings.addEventListener('click', openModal)
  if (btnQuickQr)  btnQuickQr.addEventListener('click', openQrModal)
  if (modalClose)  modalClose.addEventListener('click', closeModal)
  if (modalBack)   modalBack.addEventListener('click', closeModal)

  // Fermeture échappe
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSidebar()
      closeModal()
    }
  })

  // Export
  window.NavModule = {
    openSidebar,
    closeSidebar,
    openModal,
    closeModal
  }

})()
