'use strict'

const { dbg } = require('../logger')
const orchestrator = require('../core/services/TunnelManager')
const cluster = require('../core/services/cluster-manager')
const GpsSimulator = require('../core/services/gps/GpsSimulator')
const RegistryBridge = require('../adapters/RegistryBridge')

/**
 * ElectronTarget - Orchestrateur pour la version Desktop.
 */
class ElectronTarget {
  constructor(companionServer) {
    this.companion = companionServer
    this.simulator = new GpsSimulator(orchestrator, companionServer)
    this.bridge = new RegistryBridge(orchestrator, this.simulator, cluster, companionServer)
  }

  async start() {
    dbg('[target] 🖥️ Démarrage de la cible ELECTRON')

    try {
      // 2. Initialisation des services Core (Async)
      await orchestrator.start()
      await cluster.init()

      // 3. Démarrage du serveur compagnon
      const settings = require('../core/services/settings-manager')
      const port = settings.get('companionPort') || 8080
      this.companion.start(port)

      // 3. Liaison Simulator -> Cluster
      this.simulator.on('location-changed', (data) => {
        cluster.broadcastSync(data)
      })

      dbg('[target] ✅ Cible Electron prête')
    } catch (e) {
      dbg(`[target] ❌ Échec critique au démarrage : ${e.message}`)
      console.error(e)
    }
  }

  stop() {
    orchestrator.setQuitting()
    this.companion.stop()
    this.simulator.destroy()
    cluster.destroy()
  }
}

module.exports = ElectronTarget
