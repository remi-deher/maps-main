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
   * Analyse et nettoie un GPX externe, avec option de forcer la vitesse.
   * @param {string} gpxString Contenu du fichier GPX
   * @param {number|null} overrideSpeedKmh Vitesse forcée ou null pour garder l'original
   * @returns {string} Chemin du fichier GPX prêt à l'emploi
   */
  processExternalGpx(gpxString, overrideSpeedKmh = null) {
    dbg(`[route-generator] Traitement GPX externe (vitesse forcée: ${overrideSpeedKmh || 'non'})`)

    // Extraction simple des points via Regex
    const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g
    const points = []
    let match
    while ((match = trkptRegex.exec(gpxString)) !== null) {
      points.push({ lat: parseFloat(match[1]), lon: parseFloat(match[2]) })
    }

    if (points.length < 2) {
      throw new Error("Le fichier GPX ne contient pas assez de points de trace.")
    }

    // Si on ne force pas la vitesse ET que le fichier a déjà des timestamps, on le garde tel quel
    const hasTimestamps = gpxString.includes('<time>')
    if (!overrideSpeedKmh && hasTimestamps) {
      const gpxPath = path.join(os.tmpdir(), 'antigravity_custom.gpx')
      fs.writeFileSync(gpxPath, gpxString)
      return gpxPath
    }

    // Sinon, on recalcule tout l'itinéraire avec la vitesse demandée
    const speed = overrideSpeedKmh || 5
    const speedMs = speed / 3.6
    let totalTimeSec = 0
    let startTime = Date.now()

    let newGpx = '<?xml version="1.0" encoding="UTF-8"?>\n'
    newGpx += '<gpx version="1.1" creator="Antigravity Navigator">\n'
    newGpx += '  <trk><trkseg>\n'

    // Premier point
    newGpx += `    <trkpt lat="${points[0].lat.toFixed(6)}" lon="${points[0].lon.toFixed(6)}">\n`
    newGpx += `      <time>${new Date(startTime).toISOString()}</time>\n`
    newGpx += `    </trkpt>\n`

    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1]
      const p2 = points[i]
      const d = this._getDistance(p1.lat, p1.lon, p2.lat, p2.lon)
      const duration = d / speedMs
      totalTimeSec += duration

      const timeStr = new Date(startTime + totalTimeSec * 1000).toISOString()
      newGpx += `    <trkpt lat="${p2.lat.toFixed(6)}" lon="${p2.lon.toFixed(6)}">\n`
      newGpx += `      <time>${timeStr}</time>\n`
      newGpx += `    </trkpt>\n`
    }

    newGpx += '  </trkseg></trk>\n'
    newGpx += '</gpx>'

    const gpxPath = path.join(os.tmpdir(), 'antigravity_custom.gpx')
    fs.writeFileSync(gpxPath, newGpx)
    dbg(`[route-generator] GPX personnalisé généré (${points.length} points, ~${Math.floor(totalTimeSec/60)} min)`)
    
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
