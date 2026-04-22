'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { dbg } = require('../logger')

/**
 * NativeBonjour - Utilise l'outil dns-sd.exe de Windows (Apple Bonjour)
 * pour découvrir les services RSD quand Python/Zeroconf échoue.
 */
class NativeBonjour extends EventEmitter {
  constructor() {
    super()
    this.browseProcess = null
    this._isScanning = false
  }

  /**
   * Lance un scan bref pour trouver des instances _apple-mobdev2
   */
  async scan(timeoutMs = 10000) {
    if (this._isScanning) return
    this._isScanning = true
    dbg('[native-bonjour] lancement du scan dns-sd...')

    return new Promise((resolve) => {
      this.browseProcess = spawn('dns-sd', ['-B', '_apple-mobdev2._tcp'], { shell: true })
      
      const foundInstances = []
      
      this.browseProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          // Format expected: "Timestamp A/R Flags if Domain Service Type Instance Name"
          // On cherche la colonne "Instance Name"
          if (line.includes('_apple-mobdev2._tcp.')) {
            const parts = line.split(/\s+/)
            const iface = parts[4] // L'index d'interface (ex: 16)
            const instanceName = parts.slice(6).join(' ').trim()
            
            if (instanceName && !foundInstances.some(i => i.name === instanceName)) {
              // Extraction de l'IPv6 si présente (format mac@ipv6)
              const ipv6Match = instanceName.match(/@([\w:]+)/)
              const address = ipv6Match ? `${ipv6Match[1]}%${iface}` : null
              
              dbg(`[native-bonjour] Instance trouvée : ${instanceName} sur iFace ${iface}`)
              foundInstances.push({ name: instanceName, address })
            }
          }
        }
      })

      setTimeout(() => {
        this.stop()
        this._isScanning = false
        resolve(foundInstances)
      }, timeoutMs)
    })
  }

  /**
   * Résout une instance pour obtenir le port et l'IP
   */
  async resolve(instanceObj) {
    const { name, address } = instanceObj
    dbg(`[native-bonjour] résolution de l'instance : ${name}`)
    
    // 1. Tentative via dns-sd -L
    const nativeResult = await new Promise((resolve) => {
      const resolveProc = spawn('dns-sd', ['-L', name, '_apple-mobdev2._tcp'], { shell: true })
      let found = null

      resolveProc.stdout.on('data', (data) => {
        const text = data.toString()
        const match = text.match(/reached at .*?:(\d+)/)
        if (match) {
          found = match[1]
          resolveProc.kill()
        }
      })

      setTimeout(() => { resolveProc.kill(); resolve(found) }, 4000)
    })

    if (nativeResult) return { port: nativeResult, address }

    // 2. Fallback : Scan de ports sur l'IPv6 extraite
    if (address) {
      dbg(`[native-bonjour] Fallback : scan de ports sur ${address}...`)
      const port = await this._probeIPv6(address)
      if (port) return { port, address }
    }

    return null
  }

  /**
   * Scan léger sur l'IPv6 (Link-Local)
   */
  async _probeIPv6(address) {
    const net = require('net')
    // On scanne les plages probables (53400+ et 62000+)
    const ports = [53248, ...Array.from({ length: 60 }, (_, i) => 53400 + i), ...Array.from({ length: 60 }, (_, i) => 62000 + i)]
    
    return new Promise((resolve) => {
      let finished = false
      const done = (p) => { if (!finished) { finished = true; resolve(p) } }

      ports.forEach((p, i) => {
        setTimeout(() => {
          if (finished) return
          const s = new net.Socket()
          s.setTimeout(400)
          s.on('connect', () => { s.destroy(); done(p) })
          s.on('error', () => s.destroy())
          s.on('timeout', () => s.destroy())
          s.connect(p, address)
        }, i * 10)
      })
      setTimeout(() => done(null), 3000)
    })
  }

  stop() {
    if (this.browseProcess) {
      this.browseProcess.kill()
      this.browseProcess = null
    }
  }
}

module.exports = new NativeBonjour()
