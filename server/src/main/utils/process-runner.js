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
      priority: -10,
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

    if (this.process.pid && this.options.priority !== 0) {
      try {
        os.setPriority(this.process.pid, this.options.priority)
      } catch (e) {}
    }

    this.process.stdout.on('data', (data) => {
      const msg = Encoder.decode(data).trim()
      if (msg) this.emit('stdout', msg)
    })

    this.process.stderr.on('data', (data) => {
      const msg = Encoder.decode(data).trim()
      if (msg) {
        if (msg.toLowerCase().includes('error')) dbg(`[${this.name}] stderr: ${msg}`)
        this.emit('stderr', msg)
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
    return new Promise((resolve) => {
      if (!this.process && this.name !== 'tunneld') return resolve()
      const pid = this.process ? this.process.pid : null
      
      if (process.platform === 'win32') {
        const tasks = []
        if (pid) tasks.push(new Promise(r => exec(`taskkill /F /T /PID ${pid}`, () => r())))
        if (this.name === 'tunneld') {
          tasks.push(new Promise(r => exec('powershell "Get-Process ios -ErrorAction SilentlyContinue | Stop-Process -Force"', () => r())))
        }
        Promise.all(tasks).then(() => {
          this.process = null
          resolve()
        })
      } else {
        if (this.process) this.process.kill('SIGTERM')
        this.process = null
        resolve()
      }
    })
  }

  get isRunning() { return !!this.process }
}

module.exports = ProcessRunner
