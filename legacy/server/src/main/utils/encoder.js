'use strict'

/**
 * Encoder Utility
 * Gère la conversion propre des flux de données Windows (CP850/UTF-8)
 */
class Encoder {
  /**
   * Convertit un Buffer ou une string mal encodée en UTF-8 propre
   * @param {Buffer|string} data 
   * @returns {string}
   */
  static decode(data) {
    if (!data) return ''
    
    // Si c'est déjà une string, on vérifie si elle contient des artefacts CP850
    let str = Buffer.isBuffer(data) ? data.toString('utf8') : data

    // Si on détecte des séquences typiques de UTF-8 interprété comme CP850
    // On tente une réparation
    if (str.includes('\u251c') || str.includes('\u00ae') || str.includes('\u00d4')) {
      return this.sanitize(str)
    }

    return str
  }

  /**
   * Nettoie manuellement les séquences CP850 courantes vers UTF-8
   * @param {string} str 
   */
  static sanitize(str) {
    if (typeof str !== 'string') return str
    return str
      .replace(/\u251c\u00ae/g, 'é')   // ├® -> é
      .replace(/\u251c\u00fb/g, 'û')   // ├û -> û
      .replace(/\u251c\u00ea/g, 'ê')   // ├ê -> ê
      .replace(/\u251c\u00e0/g, 'à')   // ├à -> à
      .replace(/\u251c\u2524/g, 'à')   // ├┤ -> à
      .replace(/\u251c\u2557/g, 'ù')   // ├╗ -> ù
      .replace(/\u251c\u2502/g, 'ô')   // ├│ -> ô
      .replace(/\u251c\u00a9/g, '©')
      .replace(/\u00d4\u2020\u00ae/g, '→') // ÔåÆ -> →
      .replace(/\u00d4\u2524\u2557/g, '→')
      .replace(/\u2014/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/L\u00d4\u00e7\u00d6emplacement/g, "L'emplacement")
      .replace(/r\u00e9solution/g, "résolution")
  }
}

module.exports = Encoder
