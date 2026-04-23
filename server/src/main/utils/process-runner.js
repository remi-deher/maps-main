'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { dbg } = require('../logger')
const Encoder = require('./encoder')

/**
 * ProcessRunner - Utilitaire unifi\u00e9 pour lancer des processus externes
 * G\u00e8re l'encodage UTF-8, les variables d'environnement Python
 * et la d\u00e9tection d'erreurs communes.
 */
class ProcessRunner extends EventEmitter {
  constructor(name, options = {}) {
    super()
    this.name = name
    this.process = null
    this.options = {
      cwd: null,
      python: true, // Force PYTHONIOENCODING=utf-8
      ...options
    }
  }

  spawn(command, args, extraEnv = {}) {
    this.stop()

    const env = { ...process.env, ...extraEnv }
    if (this.options.python) {
      env.PYTHONIOENCODING = 'utf-8'
      env.PYTHONUNBUFFERED = '1'
    }

    dbg(`[${this.name}] spawn: ${command} ${args.join(' ')}`)
    
    this.process = spawn(command, args, {
      cwd: this.options.cwd,
      env,
      shell: false
    })

    // On ne fixe pas l'encodage ici car on veut manipuler le Buffer via Encoder.decode
    // this.process.stdout.setEncoding('utf8')
    // this.process.stderr.setEncoding('utf8')

    this.process.stdout.on('data', (data) => {
      const msg = Encoder.decode(data).trim()
      if (msg) {
        dbg(`[${this.name}] [stdout] : ${msg}`)
        this.emit('log', msg)
        this.emit('stdout', msg)
      }
    })

    this.process.stderr.on('data', (data) => {
      const msg = Encoder.decode(data).trim()
      if (msg) {
        dbg(`[${this.name}] [stderr] : ${msg}`)
        this.emit('log', `Erreur: ${msg}`)
        this.emit('stderr', msg)
        
        // Détection d'erreurs critiques communes (Réseau/Tunnel)
        if (msg.includes('Connection was terminated abruptly') || 
            msg.includes('WinError 1236') || 
            msg.includes('WinError 10061') ||
            msg.includes('ConnectionAbortedError')) {
           this.emit('critical-error', msg)
        }
      }
    })

    this.process.on('exit', (code, signal) => {
      dbg(`[${this.name}] processus arrete (code: ${code}, signal: ${signal})`)
      this.emit('exit', { code, signal })
      this.process = null
    })

    return this.process
  }

  stop() {
    if (this.process) {
      try {
        this.process.kill('SIGTERM')
      } catch (e) {
        dbg(`[${this.name}] erreur lors de l'arret: ${e.message}`)
      }
      this.process = null
    }
  }

  get isRunning() {
    return !!this.process
  }

  get pid() {
    return this.process ? this.process.pid : null
  }
}

module.exports = ProcessRunner
