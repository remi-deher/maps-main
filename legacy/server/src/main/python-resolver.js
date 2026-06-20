'use strict'

const path = require('path')
const fs   = require('fs')
const { execSync } = require('child_process')

/**
 * Vérifie si le service mDNS (Bonjour/Avahi) est actif.
 */
function checkServiceStatus() {
  try {
    if (process.platform === 'win32') {
      const status = execSync('powershell -Command "Get-Service -Name \'Bonjour Service\' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status"', { encoding: 'utf8' }).trim()
      return status === 'Running'
    } else if (process.platform === 'linux') {
      const status = execSync('systemctl is-active avahi-daemon', { encoding: 'utf8' }).trim()
      return status === 'active'
    }
  } catch (e) {
    return false
  }
  return false
}

/**
 * Résout le chemin vers python.exe à utiliser.
 */
function resolvePython() {
  // Sous Linux (Docker), on utilise le python3 du système installé via apt/pip
  if (process.platform === 'linux') {
    return 'python3'
  }

  // Sous Windows, on tente de charger Electron optionnellement
  try {
    const { app } = require('electron')
    
    // 1. App packagée
    if (app && app.isPackaged) {
      const bundled = path.join(process.resourcesPath, 'python', 'python.exe')
      if (fs.existsSync(bundled)) return bundled
    }

    // 2. Mode dev
    const devPath = path.join(__dirname, '..', '..', 'resources', 'python', 'python.exe')
    if (fs.existsSync(devPath)) return devPath
  } catch (e) {
    // Si Electron n'est pas dispo (mode headless Windows ou autre)
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * Résout le chemin vers un script Python.
 */
function resolveScript(scriptName) {
  if (process.platform === 'linux') {
    return path.join(__dirname, 'python', scriptName)
  }

  try {
    const { app } = require('electron')
    if (app && app.isPackaged) {
      const bundled = path.join(process.resourcesPath, 'python_scripts', scriptName)
      if (fs.existsSync(bundled)) return bundled
    }
    return path.join(app.getAppPath(), 'src', 'main', 'python', scriptName)
  } catch (e) {
    return path.join(__dirname, 'python', scriptName)
  }
}

const PYTHON = resolvePython()

module.exports = { PYTHON, resolvePython, resolveScript, checkServiceStatus }
