'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { dbg } = require('../logger')
const Encoder = require('../utils/encoder')

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
        const lines = Encoder.decode(data).split('\n')
        for (const line of lines) {
          // Format expected: "Timestamp A/R Flags if Domain Service Type Instance Name"
          // On cherche la colonne "Instance Name"
          if (line.includes('_apple-mobdev2._tcp.')) {
            const parts = line.split(/\s+/)
            const iface = parts[3] // L'index d'interface (ex: 16)
            const instanceName = parts.slice(6).join(' ').trim()
            
            if (instanceName && !foundInstances.some(i => i.name === instanceName)) {
              // Extraction de l'IPv6 si presente (format mac@ipv6)
              const ipv6Match = instanceName.match(/@([\w:]+)/)
              const address = ipv6Match ? `${ipv6Match[1]}%${iface}` : null
              
              dbg(`[native-bonjour] Instance trouvee : ${instanceName} sur iFace ${iface}`)
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

  async resolve(instanceObj) {
    const { name, address } = instanceObj
    dbg(`[native-bonjour] resolution de l'instance : ${name} (${address || 'auto'})`)
    
    // 1. PRIORITE ABSOLUE : Si on a une IP manuelle (souvent IPv4 via WebSocket), on tente la resolution directe.
    if (address && (name === 'Manual' || !address.includes(':'))) {
      dbg(`[native-bonjour] Resolution PRIORITAIRE sur ${address}...`)
      const port = await this._probeAddress(address)
      if (port) return { port, address }
      if (name === 'Manual') return null // On s'arrête là si c'était spécifiquement demandé en manuel
    }

    // 2. Tentative via dns-sd -L (pour les instances Bonjour reelles)
    const nativeResult = await new Promise((resolve) => {
      const resolveProc = spawn('dns-sd', ['-L', name, '_apple-mobdev2._tcp'], { shell: true })
      let found = null

      resolveProc.stdout.on('data', (data) => {
        const text = Encoder.decode(data)
        const match = text.match(/reached at (.*?):(\d+)/)
        if (match) {
          found = { host: match[1].replace(/\.$/, ''), port: match[2] }
          resolveProc.kill()
        }
      })

      setTimeout(() => { resolveProc.kill(); resolve(found) }, 4000)
    })

    if (nativeResult) {
      // On prefere l'adresse IPv6 extraite du nom si presente, sinon on prend le host resolu
      const finalAddress = address || nativeResult.host
      return { port: nativeResult.port, address: finalAddress }
    }

    // 3. Fallback : Scan de ports sur l'adresse (IPv6 ou IPv4)
    if (address) {
      dbg(`[native-bonjour] Fallback : scan de ports sur ${address}...`)
      const port = await this._probeAddress(address)
      if (port) return { port, address }
    }

    return null
  }

  /**
   * Scan léger de ports sur une adresse (IPv4 ou IPv6)
   */
  async _probeAddress(address) {
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
