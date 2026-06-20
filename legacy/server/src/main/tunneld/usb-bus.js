'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { dbg, sendStatus } = require('../logger')
const { PYTHON } = require('../python-resolver')
const { TUNNEL_RESTART_DELAY, TUNNEL_RESTART_DELAY_LONG } = require('../constants')

/**
 * Gère le démon USB (pymobiledevice3 remote tunneld)
 */
class UsbBus extends EventEmitter {
  constructor() {
    super()
    this.process = null
    this.restartTimer = null
    this._isQuitting = false
  }

  start() {
    if (this._isQuitting) return
    this.stop()

    sendStatus('tunneld', 'starting', 'Recherche iPhone USB...')
    dbg('[usb-bus] spawn remote tunneld')

    this.process = spawn(PYTHON, ['-m', 'pymobiledevice3', 'remote', 'tunneld'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const onData = (data) => {
      const text = data.toString().trim()
      if (text) dbg(`[usb-bus] ${text}`)

      const matchRsd = text.match(/--rsd\s+([\w:.]+)\s+(\d+)/)
      if (matchRsd) {
        // Détection stricte USB vs Network
        const isUSB = text.includes('-USB') || !text.includes('-Network')
        this.emit('connection', {
          address: matchRsd[1],
          port: matchRsd[2],
          type: isUSB ? 'USB' : 'Network'
        })
      }

      this._checkDisconnection(text)
    }

    this.process.stdout.on('data', onData)
    this.process.stderr.on('data', onData)

    this.process.on('error', (err) => {
      dbg(`[usb-bus] ERREUR: ${err.message}`)
      this._scheduleRestart(TUNNEL_RESTART_DELAY)
    })

    this.process.on('exit', (code, signal) => {
      if (this._isQuitting || this.restartTimer) return
      dbg(`[usb-bus] EXIT ${signal || code}`)
      this.emit('exit', { code, signal })
      this._scheduleRestart(TUNNEL_RESTART_DELAY)
    })
  }

  _checkDisconnection(text) {
    const textLower = text.toLowerCase()
    if (
      textLower.includes('disconnected') || 
      textLower.includes('removed') || 
      textLower.includes('connection lost') ||
      textLower.includes('broken pipe') ||
      (textLower.includes('usbmux') && textLower.includes('error'))
    ) {
      dbg(`[usb-bus] déconnexion détectée : "${text}"`)
      this.emit('disconnection', 'USB débranché ou perdu')
      this.stop()
      this._scheduleRestart(TUNNEL_RESTART_DELAY_LONG)
    }
  }

  _scheduleRestart(delay) {
    if (this._isQuitting || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start()
    }, delay)
  }

  stop() {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.process) {
      this.process.removeAllListeners()
      try { this.process.kill('SIGTERM') } catch (_) { }
      this.process = null
    }
  }

  destroy() {
    this._isQuitting = true
    this.stop()
  }
}

module.exports = UsbBus
