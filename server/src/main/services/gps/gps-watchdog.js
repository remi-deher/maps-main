'use strict'

const net = require('net')
const { WATCHDOG_INTERVAL } = require('../../constants')
const { dbg } = require('../../logger')

/**
 * GpsWatchdog - Surveille la connectivité du service de localisation
 */
class GpsWatchdog {
  constructor(onFailure) {
    this.onFailure = onFailure
    this.timer = null
    this.active = false
    this.target = null
  }

  start(address, port) {
    this.stop()
    this.target = { address, port }
    this.active = true
    this.timer = setInterval(() => this._check(), WATCHDOG_INTERVAL)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.active = false
    this.target = null
  }

  async _check() {
    if (!this.active || !this.target) return

    const isAlive = await new Promise((resolve) => {
      const socket = new net.Socket()
      const timer = setTimeout(() => { socket.destroy(); resolve(false) }, 2000)
      
      socket.on('error', () => { clearTimeout(timer); socket.destroy(); resolve(false) })
      socket.connect(this.target.port, this.target.address, () => {
        clearTimeout(timer)
        socket.destroy()
        resolve(true)
      })
    })

    if (!isAlive && this.active) {
      dbg(`[gps-watchdog] Perte de connexion sur ${this.target.address}:${this.target.port}`)
      this.onFailure()
    }
  }
}

module.exports = GpsWatchdog
