'use strict'

const winston = require('winston')
require('winston-daily-rotate-file')
const path = require('path')
const fs = require('fs')
const Encoder = require('./utils/encoder')

let app = null
try {
  const electron = require('electron')
  app = electron.app
} catch (e) {}

let _mainWindow = null
const logDir = app ? app.getPath('logs') : path.join(__dirname, '..', '..', 'logs')

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

// Configuration de Winston
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message}`
    })
  ),
  transports: [
    // 1. Console avec couleurs
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [${level}] ${message}`
        })
      )
    }),
    // 2. Fichier tournant pour tous les logs
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'gps-combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '20m'
    }),
    // 3. Fichier tournant spécifique pour les erreurs
    new winston.transports.DailyRotateFile({
      level: 'error',
      filename: path.join(logDir, 'gps-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d'
    })
  ]
})

/**
 * Injecter la référence à mainWindow
 */
function setWindow(win) {
  _mainWindow = win
}

/**
 * Log compatible avec l'ancien système mais propulsé par Winston
 */
function dbg(msg, level = 'info') {
  const cleanMsg = Encoder.decode(msg)
  
  // Log via Winston
  logger.log(level, cleanMsg)
  
  // Rétrocompatibilité IPC (Electron)
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('debug-log', cleanMsg)
  }
  
  // Rétrocompatibilité SSE (Docker)
  if (module.exports._headlessEventSubscribers) {
    module.exports._headlessEventSubscribers.forEach(sub => sub.onDebug(cleanMsg))
  }
}

/**
 * Envoie une mise à jour de statut
 */
function sendStatus(service, state, message, data = {}) {
  const cleanMsg = Encoder.decode(message)
  const payload = { service, state, message: cleanMsg, ...data }
  
  // On log le statut en mode "info" dans Winston
  logger.info(`[STATUS][${service}] ${state}: ${cleanMsg}`)

  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('status-update', payload)
  }
  
  if (module.exports._headlessEventSubscribers) {
    module.exports._headlessEventSubscribers.forEach(sub => sub.onStatus(payload))
  }
}

/**
 * Met à jour le niveau de verbosité de Winston
 * @param {string} newLevel 'info' (PROD), 'debug' (DEV), 'silly' (TRACE)
 */
function setLogLevel(newLevel) {
  const levels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']
  if (levels.includes(newLevel)) {
    logger.level = newLevel
    logger.transports.forEach(t => t.level = newLevel)
    logger.info(`[logger] Niveau de verbosité réglé sur : ${newLevel.toUpperCase()}`)
  }
}

module.exports = { 
  setWindow, 
  setLogLevel,
  dbg, 
  sendStatus, 
  logger, // Accès direct au logger winston si besoin
  _headlessEventSubscribers: [] 
}
