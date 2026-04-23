'use strict'

const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const Encoder = require('./utils/encoder')

let _mainWindow = null
let _logStream = null

function initLogs() {
  const logDir = app.getPath('logs')
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

app.whenReady().then(initLogs)

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
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('status-update', { service, state, message: cleanMsg, ...data })
  }
}

module.exports = { setWindow, dbg, sendStatus }
