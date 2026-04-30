'use strict'

const os = require('os')
const path = require('path')
const { dbg } = require('../logger')

/**
 * BinaryManager - Résout les alias de commandes et gère l'exécution multi-plateforme.
 */
class BinaryManager {
  constructor() {
    this.isWin = process.platform === 'win32'
  }

  /**
   * Retourne l'exécutable Python correct (python vs python3 vs embedded)
   */
  getPython() {
    const fs = require('fs')
    const { execSync } = require('child_process')
    const { getResourcePath } = require('./PathResolver')
    
    const systemAlias = this.isWin ? 'python' : 'python3'
    
    // 1. Tester la version système (PATH)
    try {
      execSync(`${systemAlias} -m pymobiledevice3 --version`, { stdio: 'ignore' })
      dbg(`[binary] 🐍 Utilisation de la version du système (${systemAlias})`)
      return systemAlias
    } catch (e) {
      // 2. Fallback sur la version embarquée
      const embeddedPath = this.isWin 
        ? getResourcePath('python/python.exe')
        : getResourcePath('python/bin/python3')

      if (fs.existsSync(embeddedPath)) {
        dbg(`[binary] 🐍 Utilisation de la version du projet (embarqué) : ${embeddedPath}`)
        return embeddedPath
      }
    }

    // 3. Ultime recours (peut-être que python est là mais sans le module, ou inversement)
    dbg(`[binary] ⚠️ Aucune version de Python valide trouvée. Tentative avec l'alias par défaut.`)
    return systemAlias
  }

  /**
   * Résout une commande logique en arguments d'exécution
   * @param {string} alias Alias de la commande (ex: 'pmd3', 'go-ios')
   * @returns {Object} { exe: string, args: string[] }
   */
  resolve(alias) {
    const python = this.getPython()

    switch (alias) {
      case 'pmd3':
        return { exe: python, args: ['-u', '-m', 'pymobiledevice3'] }
      
      case 'go-ios':
        // Le chemin vers go-ios dépend si on est en Electron (resources) ou en Headless
        const goIosPath = this.resolveGoIosPath()
        return { exe: goIosPath, args: [] }

      default:
        return { exe: alias, args: [] }
    }
  }

  /**
   * Résout le chemin vers le binaire go-ios selon la plateforme et l'environnement
   */
  resolveGoIosPath() {
    const { getResourcePath } = require('./PathResolver')
    
    if (this.isWin) {
      // Sur Windows, on cherche ios.exe dans les ressources
      return getResourcePath('ios.exe')
    } else {
      // Sur Linux/Docker, il est généralement installé dans /usr/local/bin/ios
      // On peut aussi le chercher dans les ressources si on l'a embarqué
      const embedded = getResourcePath('ios')
      const fs = require('fs')
      return fs.existsSync(embedded) ? embedded : 'ios'
    }
  }

  /**
   * Prépare les arguments pour spawn
   * @param {string} alias 
   * @param {string[]} extraArgs 
   */
  getSpawnArgs(alias, extraArgs = []) {
    const { exe, args } = this.resolve(alias)
    return {
      exe,
      fullArgs: [...args, ...extraArgs]
    }
  }
}

module.exports = new BinaryManager()
