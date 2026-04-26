'use strict'

const path = require('path')
const fs = require('fs')
const { app } = require('electron')

/**
 * Résout le chemin vers ios.exe (go-ios) à utiliser.
 *
 * Priorité :
 *  1. go-ios embarqué dans le bundle Electron → <resourcesPath>/ios.exe
 *  2. go-ios embarqué en mode dev             → <projectRoot>/resources/ios.exe
 *  3. Fallback système                         → 'ios'
 *
 * @returns {string} Chemin absolu vers ios.exe ou 'ios'
 */
function resolveGoIos() {
  // 1. App packagée
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'ios.exe')
    if (fs.existsSync(bundled)) return bundled
  }

  // 2. Mode dev
  const devPath = path.join(__dirname, '..', '..', 'resources', 'ios.exe')
  if (fs.existsSync(devPath)) return devPath

  // 3. Fallback système
  return 'ios'
}

const GOIOS = resolveGoIos()

module.exports = { GOIOS, resolveGoIos }
