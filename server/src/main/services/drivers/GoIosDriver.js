'use strict'

const BaseDriver = require('./BaseDriver')
const { dbg } = require('../../logger')
const { spawn } = require('child_process')
const path = require('path')

class GoIosDriver extends BaseDriver {
  constructor() {
    super('go-ios')
    this.process = null
  }

  async startTunnel() {
    if (this.process) return true
    this.isStarting = true
    const { GOIOS } = require('../../goios-resolver')
    const args = ['tunnel', 'start']

    dbg(`[${this.id}] 🚀 Lancement : ${GOIOS} ${args.join(' ')}`)
    
    this.process = spawn(GOIOS, args)

    this.process.stdout.on('data', (data) => {
      const text = data.toString()
      // On cherche uniquement l'adresse RSD pour marquer le driver comme prêt
      const match = text.match(/RSD address: ([\w:.%]+):(\d+)/)
      if (match) {
        this.tunnelInfo = {
          address: match[1],
          port: match[2],
          type: 'WIFI (go-ios)'
        }
        dbg(`[${this.id}] ✅ Tunnel prêt sur ${this.tunnelInfo.address}:${this.tunnelInfo.port}`)
        this.isActive = true
        this.isStarting = false
        this.emit('connection', this.tunnelInfo)
      }
      // On ne logge PAS text via dbg pour éviter le spam
      this.emit('stdout', text)
    })

    this.process.stderr.on('data', (data) => {
      const text = data.toString()
      // On ne logge les erreurs que si elles semblent critiques et non du spam proxy
      if (text.toLowerCase().includes('error') && !text.includes('Client')) {
        dbg(`[${this.id}] stderr: ${text.trim()}`)
      }
      this.emit('stderr', text)
    })

    this.process.on('close', () => {
      this.process = null
      this.isActive = false
      this.tunnelInfo = null
      this.emit('disconnection')
    })

    return true
  }

  async stopTunnel() {
    await super.stopTunnel()
    return new Promise((resolve) => {
      if (!this.process) return resolve(true)
      
      dbg(`[${this.id}] Demande de fermeture gracieuse du tunnel...`)
      this.process.kill('SIGINT') 
      
      const timer = setTimeout(() => {
        if (this.process) {
          dbg(`[${this.id}] Arrêt forcé (SIGKILL)`)
          this.process.kill('SIGKILL')
        }
        resolve(true)
      }, 3000)
      
      this.process.on('close', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  async setLocation(lat, lon) {
    if (!this.isActive || !this.tunnelInfo) return { success: false, error: 'Tunnel non prêt' }
    const { GOIOS } = require('../../goios-resolver')
    const { address, port } = this.tunnelInfo
    const args = ['setlocation', '--rsd', `${address}:${port}`, String(lat), String(lon)]
    return new Promise((resolve) => {
      const proc = spawn(GOIOS, args)
      proc.on('close', (code) => resolve({ success: code === 0 }))
    })
  }

  async clearLocation() {
    if (!this.isActive || !this.tunnelInfo) return { success: false }
    const { GOIOS } = require('../../goios-resolver')
    const { address, port } = this.tunnelInfo
    const proc = spawn(GOIOS, ['setlocation', '--rsd', `${address}:${port}`, 'reset'])
    return new Promise(res => proc.on('close', code => res({ success: code === 0 })))
  }
}

module.exports = GoIosDriver
