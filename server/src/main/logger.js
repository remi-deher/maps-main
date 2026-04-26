'use strict'

let app = null;
try {
  const electron = require('electron');
  app = electron.app;
} catch (e) {}

const fs = require('fs')
const path = require('path')
const Encoder = require('./utils/encoder')

let _mainWindow = null
let _logStream = null

function initLogs() {
  const logDir = app ? app.getPath('logs') : path.join(__dirname, '..', '..', 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  const dateStr = new Date().toISOString().split('T')[0]
  const logFile = path.join(logDir, `gps-mock-${dateStr}.log`)
  _logStream = fs.createWriteStream(logFile, { flags: 'a' })

  // Rotation : garder 7 jours
  try {
    const files = fs.readdirSync(logDir)
    const now = Date.now()
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
    for (const file of files) {
      if (!file.startsWith('gps-mock-')) continue
      const filePath = path.join(logDir, file)
      const stats = fs.statSync(filePath)
      if (now - stats.mtimeMs > SEVEN_DAYS) {
        fs.unlinkSync(filePath)
      }
    }
  } catch (_) { }
}

if (app) {
  app.whenReady().then(initLogs)
} else {
  initLogs()
}

/**
 * Injecter la référence à mainWindow après createWindow()
 * @param {Electron.BrowserWindow} win
 */
function setWindow(win) {
  _mainWindow = win
}

/**
 * Log horodaté dans la console + envoi vers le renderer via IPC debug-log
 * @param {string} msg
 */
function dbg(msg) {
  const cleanMsg = Encoder.decode(msg)
  const d = new Date()
  const time = d.toLocaleTimeString('fr-FR')
  const logLine = `[${time}] ${cleanMsg}\n`
  
  console.log(`[${time}] ${cleanMsg}`)
  
  if (_logStream) {
    _logStream.write(logLine)
  }
  
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('debug-log', cleanMsg)
  }

  if (module.exports._headlessEventSubscribers) {
    module.exports._headlessEventSubscribers.forEach(sub => sub.onDebug(cleanMsg));
  }
}

/**
 * Envoie une mise à jour de statut au renderer via IPC status-update
 * @param {string} service
 * @param {'starting'|'ready'|'stopped'} state
 * @param {string} message
 * @param {object} [data] Données supplémentaires
 */
function sendStatus(service, state, message, data = {}) {
  const cleanMsg = Encoder.decode(message)
  const payload = { service, state, message: cleanMsg, ...data };
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('status-update', payload)
  }
  
  if (module.exports._headlessEventSubscribers) {
    module.exports._headlessEventSubscribers.forEach(sub => sub.onStatus(payload));
  }
}

module.exports = { setWindow, dbg, sendStatus, _headlessEventSubscribers: [] }
