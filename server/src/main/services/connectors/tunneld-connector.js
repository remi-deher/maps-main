'use strict'

const { EventEmitter } = require('events')
const { dbg } = require('../../logger')
const { PYTHON } = require('../../python-resolver')
const ProcessRunner = require('../../utils/process-runner')

/**
 * TunneldConnector - Fallback (Priorité 3) via le démon pymobiledevice3 générique
 */
class TunneldConnector extends EventEmitter {
  constructor() {
    super()
    this.runner = new ProcessRunner('tunneld-fallback')
    this.activeConnection = null
    this._isQuitting = false

    this.runner.on('stdout', (text) => this._handleData(text))
    this.runner.on('stderr', (text) => this._handleData(text))
  }

  start() {
    if (this.runner.isRunning || this._isQuitting) return
    dbg('[tunneld-connector] Lancement du fallback TunnelId...')
    this.runner.spawn(PYTHON, ['-m', 'pymobiledevice3', 'remote', 'tunneld'])
  }

  _handleData(text) {
    if (!text) return

    const matchRsd = text.match(/--rsd\s+([\w:.%]+)\s+(\d+)/)
    if (matchRsd) {
      const address = matchRsd[1]
      const port = matchRsd[2]
      
      if (this.activeConnection?.address === address && this.activeConnection?.port === port) return
      
      const type = text.includes('usbmux') ? 'USB' : 'WiFi'
      dbg(`[tunneld-connector] Connexion detectee via fallback : ${address}:${port} (${type})`)
      this.activeConnection = { address, port, type }
      this.emit('connection', this.activeConnection)
    }

    if (text.includes('Disconnected from tunnel') || text.includes('Tunnel task failed')) {
      if (this.activeConnection) {
        this.activeConnection = null
        this.emit('disconnection')
      }
    }
  }

  stop() {
    this.runner.stop()
    this.activeConnection = null
  }

  destroy() {
    this._isQuitting = true
    this.stop()
  }
}

module.exports = TunneldConnector
