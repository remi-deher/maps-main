'use strict'

const { dbg } = require('../logger')
const orchestrator = require('../core/services/TunnelManager')
const cluster = require('../core/services/cluster-manager')
const GpsSimulator = require('../core/services/gps/GpsSimulator')
const WebBridge = require('../adapters/WebBridge')
const settings = require('../core/services/settings-manager')

/**
 * HeadlessTarget - Orchestrateur pour la version Docker / Service.
 */
class HeadlessTarget {
  constructor(companionServer) {
    this.companion = companionServer
    this.simulator = new GpsSimulator(orchestrator, companionServer)
    this.bridge = new WebBridge(orchestrator, this.simulator, cluster, companionServer)
  }

  async start() {
    dbg('[target] 🌐 Démarrage de la cible HEADLESS')

    // 1. Initialisation des services Core
    await orchestrator.start()
    await cluster.init()

    // 2. Initialisation du pont Web API & Compagnon (Partage du même port)
    const port = settings.get('companionPort') || 8080
    this.companion.start(port)
    this.bridge.init(this.companion.app)

    // 3. Liaison Simulator -> Cluster
    this.simulator.on('location-changed', (data) => {
      cluster.broadcastSync(data)
    })

    dbg('[target] ✅ Cible Headless prête')
  }

  stop() {
    orchestrator.setQuitting()
    this.simulator.destroy()
    cluster.destroy()
  }
}

module.exports = HeadlessTarget
