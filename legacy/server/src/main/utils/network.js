'use strict'

const os = require('os')

/**
 * Récupère la liste des interfaces réseau IPv4 valides
 */
function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces()
  const results = []

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // On ne garde que l'IPv4 et on ignore le loopback
      if (net.family === 'IPv4' && !net.internal) {
        results.push({
          name: name,
          address: net.address
        })
      }
    }
  }

  // Trier par nom pour la cohérence
  return results.sort((a, b) => a.name.localeCompare(b.name))
}

module.exports = { getNetworkInterfaces }
