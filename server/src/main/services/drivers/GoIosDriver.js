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
    dbg(`[${this.id}] Lancement du tunnel ios tunnel start...`)

    // On utilise le binaire ios présent dans les ressources
    const iosBin = path.join(__dirname, '..', '..', '..', 'resources', 'bin', 'ios.exe')
    
    // Commande de démarrage du tunnel RSD userspace
    this.process = spawn(iosBin, ['tunnel', 'start', '--userspace'])

    this.process.stdout.on('data', (data) => {
      const text = data.toString()
      // go-ios affiche l'adresse RSD une fois prêt
      const match = text.match(/RSD address: ([\w:.%]+):(\d+)/)
      if (match) {
        this.tunnelInfo = {
          address: match[1],
          port: match[2],
          type: 'USB (go-ios)'
        }
        this.isActive = true
        this.isStarting = false
        this.emit('connection', this.tunnelInfo)
      }
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
      
      // Sur Windows, on ne peut pas envoyer de SIGINT facilement à un processus fils
      // mais on peut fermer son entrée standard ou envoyer un signal de base.
      // La méthode Close() de go-ios est déclenchée par l'arrêt du processus.
      this.process.kill('SIGINT') 
      
      const timer = setTimeout(() => {
        if (this.process) {
          dbg(`[${this.id}] Le processus ne répond pas, arrêt forcé (SIGKILL)`)
          this.process.kill('SIGKILL')
        }
        resolve(true)
      }, 3000) // On laisse 3s à go-ios pour nettoyer l'interface utun et QUIC
      
      this.process.on('close', (code) => {
        clearTimeout(timer)
        dbg(`[${this.id}] Tunnel fermé proprement (Code ${code}).`)
        resolve(true)
      })
    })
  }

  async setLocation(lat, lon) {
    if (!this.isActive) return { success: false, error: 'Tunnel go-ios non prêt' }
    
    const iosBin = path.join(__dirname, '..', '..', '..', 'resources', 'bin', 'ios.exe')
    const args = ['setlocation', String(lat), String(lon)]
    
    return new Promise((resolve) => {
      const proc = spawn(iosBin, args)
      proc.on('close', (code) => resolve({ success: code === 0 }))
    })
  }

  async clearLocation() {
    const iosBin = path.join(__dirname, '..', '..', '..', 'resources', 'bin', 'ios.exe')
    const proc = spawn(iosBin, ['setlocation', 'reset'])
    return new Promise(res => proc.on('close', code => res({ success: code === 0 })))
  }
}

module.exports = GoIosDriver
