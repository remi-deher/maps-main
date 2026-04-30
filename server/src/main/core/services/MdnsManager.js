'use strict'

const os = require('os')
const { spawn } = require('child_process')
const { dbg } = require('../../logger')

/**
 * MdnsManager - Envoie des requêtes "Browse" mDNS pour réveiller les iPhones.
 */
class MdnsManager {
  constructor() {
    this.platform = os.platform()
    this.process = null
  }

  start() {
    if (this.process) return

    if (this.platform === 'win32') {
      this._startWindows()
    } else {
      this._startLinux()
    }
  }

  _startWindows() {
    dbg('[mdns] 🚀 Lancement du scan Bonjour (dns-sd) pour réveil iPhone...')
    // dns-sd -B lance un scan persistant qui "force" les réponses des clients sur le réseau
    this.process = spawn('dns-sd', ['-B', '_apple-mobdev2._tcp'])
    
    this.process.on('error', (err) => {
      dbg(`[mdns] ⚠️ Erreur dns-sd : ${err.message}. Assurez-vous que Bonjour/iTunes est installé.`)
    })

    this.process.on('exit', () => {
      this.process = null
    })
  }

  _startLinux() {
    dbg('[mdns] 🚀 Lancement du scan Avahi (avahi-browse) pour réveil iPhone...')
    // -r (resolve), -t (terminate after scan), -v (verbose)
    this.process = spawn('avahi-browse', ['-rt', '_apple-mobdev2._tcp'])
    
    this.process.on('error', (err) => {
      dbg(`[mdns] ⚠️ Erreur avahi-browse : ${err.message}. Assurez-vous que avahi-utils est installé.`)
    })

    this.process.on('exit', () => {
      this.process = null
    })
  }

  stop() {
    if (this.process) {
      this.process.kill()
      this.process = null
      dbg('[mdns] 🛑 Scan mDNS arrêté.')
    }
  }
}

module.exports = new MdnsManager()
