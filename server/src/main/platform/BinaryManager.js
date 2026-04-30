'use strict'

const os = require('os')
const path = require('path')
const { dbg } = require('../logger')

/**
 * BinaryManager - Résout les alias de commandes et gère l'exécution multi-plateforme.
 */
class BinaryManager {
  constructor() {
    this.platform = os.platform() // 'win32', 'linux', etc.
    this.isWin = this.platform === 'win32'
  }

  /**
   * Retourne l'exécutable Python correct (python vs python3)
   */
  getPython() {
    // Sur Windows, 'python' est l'alias standard. Sur Linux, on privilégie 'python3'.
    return this.isWin ? 'python' : 'python3'
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
        return { exe: python, args: ['-m', 'pymobiledevice3'] }
      
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
