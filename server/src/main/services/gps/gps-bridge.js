'use strict'

const net = require('net')
const path = require('path')
const { EventEmitter } = require('events')
const { dbg } = require('../../logger')
const { PYTHON } = require('../../python-resolver')
const ProcessRunner = require('../../utils/process-runner')

/**
 * GpsBridge - Client Node.js pour communiquer avec bridge.py
 */
class GpsBridge extends EventEmitter {
  constructor() {
    super()
    this.runner = new ProcessRunner('python-bridge')
    this.port = 49000
    this.host = '::1' // IPv6 Loopback
    this.isReady = false
  }

  start() {
    if (this.runner.isRunning) return

    const scriptPath = path.join(__dirname, '..', '..', 'python', 'bridge.py')
    dbg(`[gps-bridge] Lancement du pont Python...`)
    
    this.runner.spawn(PYTHON, [scriptPath])

    this.runner.on('stdout', (data) => {
      if (data.includes('BRIDGE_READY')) {
        this.isReady = true
        dbg('[gps-bridge] Le pont est pret.')
        this.emit('ready')
      }
    })

    this.runner.on('exit', () => {
      this.isReady = false
      dbg('[gps-bridge] Le pont s\'est arrete. Relance dans 2s...')
      setTimeout(() => this.start(), 2000)
    })
  }

  async sendCommand(action, rsdHost, rsdPort, payload = {}) {
    return new Promise((resolve) => {
      if (!this.isReady) {
        return resolve({ success: false, error: 'Le pont Python n\'est pas encore pret' })
      }

      const client = new net.Socket()
      const request = JSON.stringify({
        action,
        rsd_host: rsdHost,
        rsd_port: parseInt(rsdPort),
        ...payload
      })

      const timeout = setTimeout(() => {
        client.destroy()
        resolve({ success: false, error: 'Timeout communication avec le pont' })
      }, 5000)

      client.connect(this.port, this.host, () => {
        client.write(request)
      })

      client.on('data', (data) => {
        clearTimeout(timeout)
        try {
          const response = JSON.parse(data.toString())
          resolve(response)
        } catch (e) {
          resolve({ success: false, error: 'Reponse JSON invalide du pont' })
        }
        client.destroy()
      })

      client.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, error: `Erreur socket pont: ${err.message}` })
        client.destroy()
      })
    })
  }

  stop() {
    this.runner.stop()
    this.isReady = false
  }
}

module.exports = new GpsBridge()
