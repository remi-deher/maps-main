'use strict'

const { PYTHON } = require('../../python-resolver')
const ProcessRunner = require('../../utils/process-runner')
const { GPS_SEND_TIMEOUT } = require('../../constants')
const { dbg } = require('../../logger')

/**
 * GpsCommander - Exécute physiquement les commandes de simulation
 */
class GpsCommander {
  constructor() {
    this.runner = new ProcessRunner('gps-commander')
  }

  async execute(command, rsdAddress, rsdPort, extraArgs = []) {
    return new Promise((resolve) => {
      const formattedAddress = rsdAddress.includes(':') ? `[${rsdAddress}]` : rsdAddress
      dbg(`[gps-commander] Commande : ${command} sur ${formattedAddress}:${rsdPort}`)
      const args = [
        '-m', 'pymobiledevice3',
        'developer', 'dvt', 'simulate-location', command,
        '--rsd', formattedAddress, rsdPort,
      ]
      if (extraArgs.length > 0) args.push('--', ...extraArgs)

      const cmdLine = `${PYTHON} ${args.join(' ')}`
      dbg(`[gps-commander] Exec: ${cmdLine}`)
      const spawnTime = Date.now()
      const proc = this.runner.spawn(PYTHON, args)

      let stderr = ''
      let resolved = false

      const done = (result) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        resolve(result)
      }

      proc.stdout.on('data', (d) => {
        const text = d.toString()
        // Sur Windows, si on voit les invites interactives, c'est que c'est OK
        if (text.includes('Press ENTER') || text.includes('Control-C')) {
          done({ success: true, latencyMs: Date.now() - spawnTime })
        }
      })

      proc.stderr.on('data', (d) => {
        stderr += d.toString()
      })

      const timer = setTimeout(() => {
        if (!resolved) {
          // Si le processus tourne encore, on considère que c'est bon (il attend ENTER)
          if (this.runner.isRunning) done({ success: true, latencyMs: GPS_SEND_TIMEOUT })
          else done({ success: false, error: stderr || 'Timeout' })
        }
      }, GPS_SEND_TIMEOUT)

      proc.on('exit', (code) => {
        if (!resolved) {
          done({ success: code === 0, error: stderr || `Exit ${code}` })
        }
      })
    })
  }

  stop() {
    this.runner.stop()
  }
}

module.exports = GpsCommander
