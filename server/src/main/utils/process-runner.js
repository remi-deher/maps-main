const { spawn, exec } = require('child_process')
const { EventEmitter } = require('events')
const os = require('os')
const { dbg } = require('../logger')
const Encoder = require('./encoder')

/**
 * ProcessRunner - Utilitaire unifié pour lancer des processus externes
 */
class ProcessRunner extends EventEmitter {
  constructor(name, options = {}) {
    super()
    this.name = name
    this.process = null
    this.options = {
      cwd: null,
      python: true, 
      priority: -10, // Haute priorité par défaut (-20 à 19)
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
    if (this.process || this.name === 'tunneld') {
      const pid = this.process ? this.process.pid : null
      dbg(`[${this.name}] Arret du processus${pid ? ` (PID: ${pid})` : ''}...`)
      
      if (process.platform === 'win32') {
        try {
          // 1. Essayer de tuer par PID si disponible (Synchrone pour bloquer jusqu'à libération)
          if (pid) {
            const { execSync } = require('child_process')
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
          }
        } catch (e) { /* ignore */ }

        try {
          // 2. Nettoyage de secours : Tuer tout processus python lié à cette tâche
          if (this.name === 'tunneld') {
            const { execSync } = require('child_process')
            const cleanCmd = 'powershell "Get-CimInstance Win32_Process -Filter \\"Name = \'python.exe\' AND CommandLine LIKE \'%remote tunneld%\'\\" | Stop-Process -Force -ErrorAction SilentlyContinue"'
            execSync(cleanCmd, { stdio: 'ignore' })
          }
        } catch (e) { /* ignore */ }

        try {
          // 3. ULTIME RECOURS : Tuer le processus qui occupe le port 49151
          if (this.name === 'tunneld') {
            const { execSync } = require('child_process')
            const killPortCmd = 'powershell "Get-NetTCPConnection -LocalPort 49151 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"'
            execSync(killPortCmd, { stdio: 'ignore' })
            dbg(`[${this.name}] Port 49151 libere de force (Sync).`)
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
