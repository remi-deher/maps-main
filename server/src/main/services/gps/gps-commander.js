'use strict'

const gpsBridge = require('./gps-bridge')
const { dbg } = require('../../logger')

/**
 * GpsCommander - Exécute les commandes via le pont Python persistant
 */
class GpsCommander {
  constructor() {
    // Initialisation du pont au démarrage
    gpsBridge.start()
  }

  async execute(command, rsdAddress, rsdPort, extraArgs = []) {
    dbg(`[gps-commander] Commande via PONT : ${command} sur ${rsdAddress}:${rsdPort}`)
    
    let action = ''
    let payload = {}

    if (command === 'set') {
      action = 'set_location'
      payload = { lat: parseFloat(extraArgs[0]), lon: parseFloat(extraArgs[1]) }
    } else if (command === 'clear') {
      action = 'clear_location'
    } else {
      return { success: false, error: `Commande inconnue du pont: ${command}` }
    }

    // On passe par le pont au lieu du CLI
    const result = await gpsBridge.sendCommand(action, rsdAddress, rsdPort, payload)
    
    if (!result.success) {
      dbg(`[gps-commander] Echec via pont : ${result.error}`)
    }
    
    return result
  }

  stop() {
    // Le pont est géré globalement, on n'arrête rien ici
  }
}

module.exports = GpsCommander
