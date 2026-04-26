'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { dbg } = require('../../logger')

/**
 * RouteGenerator - Calcule et génère des fichiers GPX pour la simulation de mouvement.
 */
class RouteGenerator {
  /**
   * Génère un fichier GPX en ligne droite entre deux points (Orthodromie).
   * @param {Object} start {lat, lon}
   * @param {Object} end {lat, lon}
   * @param {number} speedKmh Vitesse en km/h
   * @returns {string} Chemin absolu du fichier GPX généré
   */
  generateOrthodromicGpx(start, end, speedKmh = 5) {
    const dist = this._getDistance(start.lat, start.lon, end.lat, end.lon)
    const speedMs = speedKmh / 3.6
    const totalSeconds = Math.floor(dist / speedMs)
    const updateInterval = 1 // 1 point par seconde

    dbg(`[route-generator] Génération trajet : ${dist.toFixed(0)}m à ${speedKmh}km/h (~${Math.floor(totalSeconds/60)} min)`)

    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n'
    gpx += '<gpx version="1.1" creator="Antigravity Navigator">\n'
    gpx += '  <trk><trkseg>\n'

    const startTime = Date.now()

    for (let i = 0; i <= totalSeconds; i += updateInterval) {
      const fraction = totalSeconds === 0 ? 1 : i / totalSeconds
      const lat = start.lat + (end.lat - start.lat) * fraction
      const lon = start.lon + (end.lon - start.lon) * fraction

      // Format ISO 8601 string (UTC 'Z' par défaut en JS)
      const timeStr = new Date(startTime + i * 1000).toISOString()

      gpx += `    <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">\n`
      gpx += `      <time>${timeStr}</time>\n`
      gpx += `    </trkpt>\n`
    }

    gpx += '  </trkseg></trk>\n'
    gpx += '</gpx>'

    const gpxPath = path.join(os.tmpdir(), 'antigravity_route.gpx')
    fs.writeFileSync(gpxPath, gpx)
    
    return gpxPath
  }

  /**
   * Distance Haversine en mètres
   */
  _getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3
    const φ1 = lat1 * Math.PI / 180
    const φ2 = lat2 * Math.PI / 180
    const Δφ = (lat2 - lat1) * Math.PI / 180
    const Δλ = (lon2 - lon1) * Math.PI / 180

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }
}

module.exports = new RouteGenerator()
