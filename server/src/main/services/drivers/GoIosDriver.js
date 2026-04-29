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
    const settings = require('../settings-manager')
    const args = ['tunnel', 'start']

    dbg(`[${this.id}] 🚀 Lancement : ${GOIOS} ${args.join(' ')}`)
    
    this.process = spawn(GOIOS, args)

    this.process.stdout.on('data', (data) => {
      const text = data.toString()
      if (text.includes('"event: 0"')) return // Filtrage spam heartbeat go-ios
      
      dbg(`[${this.id}] stdout: ${text.trim()}`)
      this.emit('stdout', text)
      
      // go-ios affiche l'adresse RSD une fois prêt
      const match = text.match(/RSD address: ([\w:.%]+):(\d+)/)
      if (match) {
        this.tunnelInfo = {
          address: match[1],
          port: match[2],
          type: 'WIFI (go-ios forced IP)'
        }
        this.isActive = true
        this.isStarting = false
        this.emit('connection', this.tunnelInfo)
      }
    })

    this.process.stderr.on('data', (data) => {
      const text = data.toString()
      if (text.includes('"event: 0"')) return // Filtrage spam heartbeat go-ios
      
      dbg(`[${this.id}] stderr: ${text.trim()}`)
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
    if (!this.isActive || !this.tunnelInfo) return { success: false, error: 'Tunnel go-ios non prêt' }
    
    const { GOIOS } = require('../../goios-resolver')
    const { address, port } = this.tunnelInfo
    
    // On utilise l'adresse RSD du tunnel déjà ouvert pour être plus rapide
    const args = ['setlocation', '--rsd', `${address}:${port}`, String(lat), String(lon)]
    
    return new Promise((resolve) => {
      dbg(`[${this.id}] Injection via go-ios : ${lat}, ${lon} (RSD: ${address}:${port})`)
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
