'use strict'

/**
 * INDEX-HEADLESS.JS (V2)
 * Point d'entrée pour le serveur en mode Docker / Linux / Service.
 */

const { dbg } = require('./logger')
const CompanionServer = require('./core/services/companion-server')
const HeadlessTarget = require('./targets/HeadlessTarget')
const orchestrator = require('./core/services/TunnelManager')

async function bootstrap() {
  dbg('[headless] 🚀 Démarrage du serveur en mode HEADLESS (V2)')

  const companion = new CompanionServer(orchestrator)
  const target = new HeadlessTarget(companion)

  // Gestion de l'arrêt propre
  process.on('SIGINT', () => {
    dbg('[headless] 🛑 Signal SIGINT reçu. Fermeture...')
    target.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    dbg('[headless] 🛑 Signal SIGTERM reçu. Fermeture...')
    target.stop()
    process.exit(0)
  })

  try {
    await target.start()
    dbg('[headless] ✅ Serveur prêt et dashboard actif.')
  } catch (err) {
    dbg(`[headless] ❌ Erreur fatale au démarrage : ${err.message}`)
    process.exit(1)
  }
}

bootstrap()
