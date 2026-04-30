'use strict'

const gpsBridge = require('./gps-bridge')
const { dbg } = require('../../../logger')

/**
 * GpsCommander - Exécute les commandes via le pont de drivers
 */
class GpsCommander {
  constructor() {
    // Le bridge est initialisé par l'orchestrateur
  }

  async execute(command, _unusedAddress, _unusedPort, extraArgs = []) {
    if (command === 'set') {
      const lat = parseFloat(extraArgs[0])
      const lon = parseFloat(extraArgs[1])
      return await gpsBridge.setLocation(lat, lon)
    } else if (command === 'clear') {
      return await gpsBridge.clearLocation()
    } else if (command === 'heartbeat') {
      // Pour le heartbeat, on renvoie simplement un succès si le bridge est prêt
      return { success: gpsBridge.isReady }
    }
    
    return { success: false, error: `Commande inconnue: ${command}` }
  }

  stop() {
    // Rien à faire ici
  }
}

module.exports = GpsCommander
