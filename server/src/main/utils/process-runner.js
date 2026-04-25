const { spawn, exec } = require('child_process')
const { EventEmitter } = require('events')
const os = require('os')
const { dbg } = require('../logger')
const Encoder = require('./encoder')

/**
 * ProcessRunner - Utilitaire unifié pour lancer des processus externes (Optimisé go-ios)
 */
class ProcessRunner extends EventEmitter {
  constructor(name, options = {}) {
    super()
    this.name = name
    this.process = null
    this.options = {
      cwd: null,
      priority: -10, // Haute priorité par défaut (-20 à 19)
      ...options
    }
  }

  spawn(command, args, extraEnv = {}) {
    this.stop()

    const env = { ...process.env, ...extraEnv }

    dbg(`[${this.name}] spawn: ${command} ${args.join(' ')}`)
    
    this.process = spawn(command, args, {
      cwd: this.options.cwd,
      env,
      shell: false
    })

    // Application de la priorité CPU
    if (this.process.pid && this.options.priority !== 0) {
      try {
        os.setPriority(this.process.pid, this.options.priority)
        dbg(`[${this.name}] Priorite fixee a ${this.options.priority}`)
      } catch (e) {
        dbg(`[${this.name}] Impossible de fixer la priorite: ${e.message}`)
      }
    }

    this.process.stdout.on('data', (data) => {
      const msg = Encoder.decode(data).trim()
      if (msg) {
        // Trop de verbeux dans stdout pour go-ios, on ne dbg que via tunneld-service
        this.emit('stdout', msg)
      }
    })

    this.process.stderr.on('data', (data) => {
      const msg = Encoder.decode(data).trim()
      if (msg) {
        this.emit('stderr', msg)
        
        if (msg.includes('Connection was terminated abruptly') || 
            msg.includes('ERROR') || 
            msg.includes('failed')) {
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
    if (this.process || this.name === 'tunneld') {
      const pid = this.process ? this.process.pid : null
      dbg(`[${this.name}] Arret du processus${pid ? ` (PID: ${pid})` : ''}...`)
      
      if (process.platform === 'win32') {
        try {
          if (pid) {
            const { execSync } = require('child_process')
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
          }
        } catch (e) { /* ignore */ }

        try {
          // Nettoyage de secours : Tuer tout processus ios.exe lié au tunnel
          if (this.name === 'tunneld') {
            const { execSync } = require('child_process')
            const cleanCmd = 'powershell "Get-CimInstance Win32_Process -Filter \\"Name = \'ios.exe\' AND CommandLine LIKE \'%tunnel start%\'\\" | Stop-Process -Force -ErrorAction SilentlyContinue"'
            execSync(cleanCmd, { stdio: 'ignore' })
          }
        } catch (e) { /* ignore */ }

        try {
          // Libération du port de l'API go-ios (28100)
          if (this.name === 'tunneld') {
            const { execSync } = require('child_process')
            const killPortCmd = 'powershell "Get-NetTCPConnection -LocalPort 28100 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"'
            execSync(killPortCmd, { stdio: 'ignore' })
            dbg(`[${this.name}] Port 28100 libere de force.`)
          }
        } catch (e) { /* ignore */ }
      } else if (this.process) {
        this.process.kill('SIGTERM')
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
