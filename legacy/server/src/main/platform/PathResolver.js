'use strict'

const path = require('path')
const os = require('os')

/**
 * PathResolver - Centralise la gestion des chemins selon le mode de déploiement.
 */

// Détection du mode (Electron vs Headless)
// On vérifie process.versions.electron car require('electron') peut réussir dans un environnement Node standard si le package est présent
const isElectron = !!(process.versions && process.versions.electron)

/**
 * Retourne le chemin racine de l'application
 */
function getAppRoot() {
  if (isElectron) {
    const { app } = require('electron')
    if (app && typeof app.getAppPath === 'function') {
      return app.getAppPath()
    }
  }
  // En mode headless, on suppose que __dirname est dans src/main/platform
  return path.join(__dirname, '../../..')
}

/**
 * Retourne le chemin vers un fichier de ressource (binaire, script)
 */
function getResourcePath(fileName = '') {
  if (isElectron) {
    const { app } = require('electron')
    if (app) {
      // En Electron packagé, les ressources sont dans process.resourcesPath
    if (app.isPackaged) {
      return path.join(process.resourcesPath, fileName)
    }
    // En dev Electron, elles sont dans le dossier resources/
    return path.join(getAppRoot(), 'resources', fileName)
    }
  }

  // En mode Headless, on cherche dans le dossier resources/ à la racine du projet
  return path.join(getAppRoot(), 'resources', fileName)
}

/**
 * Retourne le chemin vers le dossier de stockage (réglages, cache)
 */
function getStoragePath(fileName = '') {
  if (isElectron) {
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      const userData = app.getPath('userData')
      return path.join(userData, fileName)
    }
  }

  // En mode Headless, on utilise un dossier 'storage' à la racine
  const storageDir = path.join(getAppRoot(), 'storage')
  
  // Création du dossier si inexistant (Headless seulement, Electron le fait déjà)
  const fs = require('fs')
  if (!fs.existsSync(storageDir)) {
    try { fs.mkdirSync(storageDir, { recursive: true }) } catch (e) {}
  }
  
  return path.join(storageDir, fileName)
}

module.exports = {
  getAppRoot,
  getResourcePath,
  getStoragePath,
  isElectron
}
