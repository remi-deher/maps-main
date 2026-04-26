'use strict'

const path = require('path')
const fs = require('fs')

/**
 * Résout le chemin vers ios.exe (go-ios) à utiliser.
 */
function resolveGoIos() {
  if (process.platform === 'linux') {
    return 'ios'
  }

  try {
    const { app } = require('electron')
    // 1. App packagée
    if (app && app.isPackaged) {
      const bundled = path.join(process.resourcesPath, 'ios.exe')
      if (fs.existsSync(bundled)) return bundled
    }

    // 2. Mode dev
    const devPath = path.join(__dirname, '..', '..', 'resources', 'ios.exe')
    if (fs.existsSync(devPath)) return devPath
  } catch (e) {
    // Mode headless Windows ou Electron non dispo
  }

  return 'ios'
}

const GOIOS = resolveGoIos()

module.exports = { GOIOS, resolveGoIos }
