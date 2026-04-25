'use strict'

const path = require('path')
const fs   = require('fs')
const { app } = require('electron')

/**
 * Résout le chemin vers python.exe à utiliser.
 *
 * Priorité :
 *  1. Python embarqué dans le bundle Electron  → <resourcesPath>/python/python.exe
 *  2. Python embarqué en mode dev              → <projectRoot>/resources/python/python.exe
 *  3. Fallback système                         → 'python3'
 *
 * @returns {string} Chemin absolu vers python.exe ou 'python3'
 */
function resolvePython() {
  // 1. App packagée : process.resourcesPath est défini par Electron au runtime
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'python', 'python.exe')
    if (fs.existsSync(bundled)) return bundled
  }

  // 2. Mode dev : chercher dans resources/python/ à la racine du projet
  const devPath = path.join(__dirname, '..', '..', 'resources', 'python', 'python.exe')
  if (fs.existsSync(devPath)) return devPath

  // 3. Fallback : Python système
  return 'python3'
}

/**
 * Résout le chemin vers un script Python.
 * En prod, cherche dans le dossier 'python_scripts' (extraResources).
 * En dev, cherche dans 'src/main/python/'.
 *
 * @param {string} scriptName Nom du fichier script (ex: 'bridge.py')
 * @returns {string} Chemin absolu vers le script
 */
function resolveScript(scriptName) {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'python_scripts', scriptName)
    if (fs.existsSync(bundled)) return bundled
  }

  return path.join(app.getAppPath(), 'src', 'main', 'python', scriptName)
}

// Résolution faite une seule fois au démarrage
const PYTHON = resolvePython()

// Exportation des constantes ET des fonctions
module.exports = { PYTHON, resolvePython, resolveScript }
