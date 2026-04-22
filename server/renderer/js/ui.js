/**
 * ui.js — Point d'entrée des modules UI
 * 
 * Ce fichier sert maintenant de registre central pour les composants UI
 * découpés dans le dossier ./ui/
 */

;(function () {
  'use strict'

  // L'objet UIModule est peuplé par les sous-modules (theme.js, logger.js, etc.)
  // On s'assure juste qu'il existe et on peut y ajouter des fonctions globales
  // si nécessaire.
  
  if (!window.UIModule) window.UIModule = {}

  // Note: Les event listeners spécifiques ont été déplacés dans chaque module.
  // Ce fichier peut servir à coordonner des actions complexes entre modules
  // si le besoin s'en fait sentir.

  console.log('[UIModule] Initialisé avec les composants découpés.')
})()
