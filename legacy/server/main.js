'use strict'

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ UNHANDLED REJECTION:', reason);
});

/**
 * main.js — Point d'entrée Electron
 *
 * Ce fichier ne contient plus aucune logique métier.
 * Tout est délégué aux modules de src/main/.
 */

require('./src/main/window')