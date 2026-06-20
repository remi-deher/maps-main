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
   * Génère un itinéraire routier via OSRM.
   * @param {Object} start {lat, lon}
   * @param {Object} end {lat, lon}
   * @param {string} profile 'driving', 'walking', 'cycling'
   * @param {number|null} speedKmh Vitesse forcée ou null (vitesse par défaut du profil)
   * @returns {Promise<string>} Chemin du fichier GPX
   */
  async generateOsrmRoute(start, end, profile = 'driving', speedKmh = null) {
    dbg(`[route-generator] Calcul itinéraire OSRM (${profile})...`)
    
    try {
      // OSRM attend longitude,latitude
      const url = `http://router.project-osrm.org/route/v1/${profile}/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`
      
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      
      const data = await response.json()
      if (!data.routes || data.routes.length === 0) {
        throw new Error("Aucun itinéraire trouvé par OSRM")
      }

      const route = data.routes[0]
      const coordinates = route.geometry.coordinates // [ [lon, lat], ... ]
      const duration = route.duration // en secondes (vitesse théorique d'OSRM)
      const distance = route.distance // en mètres

      // Si on ne force pas la vitesse, on utilise la durée estimée par OSRM
      // Sinon, on recalcule en fonction de speedKmh
      const usedSpeedMs = speedKmh ? (speedKmh / 3.6) : (distance / duration)
      const startTime = Date.now()
      let totalTimeSec = 0

      let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n'
      gpx += '<gpx version="1.1" creator="Antigravity OSRM">\n'
      gpx += '  <trk><trkseg>\n'

      // Premier point
      gpx += `    <trkpt lat="${coordinates[0][1].toFixed(6)}" lon="${coordinates[0][0].toFixed(6)}">\n`
      gpx += `      <time>${new Date(startTime).toISOString()}</time>\n`
      gpx += `    </trkpt>\n`

      for (let i = 1; i < coordinates.length; i++) {
        const p1 = { lat: coordinates[i-1][1], lon: coordinates[i-1][0] }
        const p2 = { lat: coordinates[i][1], lon: coordinates[i][0] }
        
        const d = this._getDistance(p1.lat, p1.lon, p2.lat, p2.lon)
        const segmentDuration = d / usedSpeedMs
        totalTimeSec += segmentDuration

        const timeStr = new Date(startTime + totalTimeSec * 1000).toISOString()
        gpx += `    <trkpt lat="${p2.lat.toFixed(6)}" lon="${p2.lon.toFixed(6)}">\n`
        gpx += `      <time>${timeStr}</time>\n`
        gpx += `    </trkpt>\n`
      }

      gpx += '  </trkseg></trk>\n'
      gpx += '</gpx>'

      const gpxPath = path.join(os.tmpdir(), 'antigravity_osrm.gpx')
      fs.writeFileSync(gpxPath, gpx)
      dbg(`[route-generator] Route OSRM prête : ${distance.toFixed(0)}m, ~${Math.floor(totalTimeSec/60)} min`)
      
      return gpxPath

    } catch (e) {
      dbg(`[route-generator] ⚠️ Échec OSRM (${e.message}). Fallback vers ligne droite...`)
      // Fallback Étape 1 : Ligne droite
      return this.generateOrthodromicGpx(start, end, speedKmh || 5)
    }
  }

  /**
   * Génère un itinéraire multimodal complexe.
   * @param {Array} legs [{ type, start, end, startTime, endTime, speed }]
   * @returns {Promise<string>} Chemin du fichier GPX maître
   */
  async generateMultimodalGpx(legs) {
    dbg(`[route-generator] Assemblage d'un trajet multimodal (${legs.length} étapes)...`)
    
    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n'
    gpx += '<gpx version="1.1" creator="Antigravity Multimodal">\n'
    gpx += '  <trk><trkseg>\n'

    for (const leg of legs) {
      const { type, start, end, startTime, endTime, speed } = leg
      const startMs = startTime || Date.now()
      const endMs = endTime || (startMs + 10000)
      const durationMs = endMs - startMs

      if (type === 'wait') {
        // Ajout de "Jitter" pour ne pas être parfaitement statique (anti-ban)
        // On génère un point toutes les 10 secondes
        for (let t = 0; t < durationMs; t += 10000) {
          const jitterLat = (Math.random() - 0.5) * 0.00001
          const jitterLon = (Math.random() - 0.5) * 0.00001
          const timeStr = new Date(startMs + t).toISOString()
          gpx += `    <trkpt lat="${(start.lat + jitterLat).toFixed(6)}" lon="${(start.lon + jitterLon).toFixed(6)}">\n`
          gpx += `      <time>${timeStr}</time>\n`
          gpx += `    </trkpt>\n`
        }
      } 
      else if (type === 'flight') {
        // Ligne droite avec accélération au début et à la fin (easing)
        const steps = Math.max(20, Math.floor(durationMs / 5000)) // 1 point toutes les 5s
        for (let i = 0; i <= steps; i++) {
          const progress = i / steps
          // Easing simple : sinusoidal pour ralentir aux extrémités
          const easedProgress = 0.5 * (1 - Math.cos(progress * Math.PI))
          
          const lat = start.lat + (end.lat - start.lat) * easedProgress
          const lon = start.lon + (end.lon - start.lon) * easedProgress
          const timeStr = new Date(startMs + progress * durationMs).toISOString()
          
          gpx += `    <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">\n`
          gpx += `      <time>${timeStr}</time>\n`
          gpx += `    </trkpt>\n`
        }
      }
      else if (type === 'walk' || type === 'drive') {
        // Routage OSRM
        try {
          const profile = type === 'walk' ? 'walking' : 'driving'
          const url = `http://router.project-osrm.org/route/v1/${profile}/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`
          
          const response = await fetch(url)
          const data = await response.json()
          
          if (data.routes && data.routes.length > 0) {
            const coordinates = data.routes[0].geometry.coordinates
            for (let i = 0; i < coordinates.length; i++) {
              const progress = i / (coordinates.length - 1)
              const timeStr = new Date(startMs + progress * durationMs).toISOString()
              gpx += `    <trkpt lat="${coordinates[i][1].toFixed(6)}" lon="${coordinates[i][0].toFixed(6)}">\n`
              gpx += `      <time>${timeStr}</time>\n`
              gpx += `    </trkpt>\n`
            }
          }
        } catch (e) {
          dbg(`[route-generator] ⚠️ Erreur OSRM dans leg multimodal: ${e.message}`)
        }
      }
    }

    gpx += '  </trkseg></trk>\n'
    gpx += '</gpx>'

    const gpxPath = path.join(os.tmpdir(), 'antigravity_multimodal.gpx')
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

  /**
   * Analyse un contenu GPX pour en extraire les points.
   * @param {string} gpxString 
   * @returns {Array} List of {lat, lon, time}
   */
  parseGpx(gpxString) {
    const points = []
    const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g
    const timeRegex = /<time>([^<]+)<\/time>/
    
    let match
    while ((match = trkptRegex.exec(gpxString)) !== null) {
      const lat = parseFloat(match[1])
      const lon = parseFloat(match[2])
      const content = match[3]
      const timeMatch = content.match(timeRegex)
      const time = timeMatch ? new Date(timeMatch[1]).getTime() : null
      
      points.push({ lat, lon, time })
    }
    
    dbg(`[route-generator] GPX parsé : ${points.length} points extraits.`)
    return points
  }
}

module.exports = new RouteGenerator()
