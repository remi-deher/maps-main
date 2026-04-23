'use strict'

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { dbg } = require('../logger')

/**
 * ProcessRunner - Utilitaire unifié pour lancer des processus externes
 * Gère l'encodage UTF-8, les variables d'environnement Python
 * et la détection d'erreurs communes.
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

    this.process.stdout.setEncoding('utf8')
    this.process.stderr.setEncoding('utf8')

    this.process.stdout.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) {
        dbg(`[${this.name}] [stdout] : ${msg}`)
        this.emit('log', msg)
        this.emit('stdout', msg)
      }
    })

    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim()
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
      dbg(`[${this.name}] processus arrêté (code: ${code}, signal: ${signal})`)
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
        dbg(`[${this.name}] erreur lors de l'arrêt: ${e.message}`)
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
