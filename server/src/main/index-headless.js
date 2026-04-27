'use strict'

/**
 * INDEX-HEADLESS.JS
 * Point d'entrée pour le serveur en mode Docker / Linux.
 * Remplace window.js (Electron).
 */

const path = require('path');
const express = require('express');
const http = require('http');

// --- MOCK ELECTRON IPC ---
const ipcHandlers = {};
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'electron') {
    return {
      ipcMain: {
        handle: (channel, listener) => { ipcHandlers[channel] = listener; },
        on: (channel, listener) => { ipcHandlers[channel] = listener; }
      },
      app: { 
        getPath: () => path.join(__dirname, '../../logs'), 
        isPackaged: false, 
        getAppPath: () => path.join(__dirname, '..', '..'),
        whenReady: async () => {}
      },
      shell: { openPath: () => {} },
      dialog: { showOpenDialog: async () => ({ canceled: true }) },
      BrowserWindow: {}, Tray: {}, Menu: {}, nativeImage: {}
    };
  }
  return originalRequire.apply(this, arguments);
};

const { dbg } = require('./logger');

// Chargement des services
const CompanionServer = require('./services/companion-server');
const tunnelManager = require('./tunneld-manager');
const GpsSimulator = require('./services/gps/gps-simulator');
const { registerIpcHandlers } = require('./ipc/registry');

dbg('-------------------------------------------');
dbg('   GPS MOCK SERVER - MODE HEADLESS (DOCKER)  ');
dbg('-------------------------------------------');

async function startServer() {
  try {
    dbg('[server] Initialisation des services...');
    
    // usbmuxd est maintenant géré par l'entrypoint.sh au niveau système


    // Initialisation comme dans window.js
    const companion = new CompanionServer(tunnelManager);
    const gps = new GpsSimulator(tunnelManager, companion);

    dbg('[server] Démarrage du companion-server...');
    
    // Enregistrement des handlers IPC (vers notre mock)
    registerIpcHandlers(tunnelManager, gps, companion);

    // --- API REST POUR LE DASHBOARD WEB ---
    companion.app.get('/web-api.js', (req, res) => {
      res.sendFile(path.join(__dirname, 'web-api.js'));
    });

    companion.app.post('/api/ipc/:action', async (req, res) => {
      const action = req.params.action;
      const handler = ipcHandlers[action];
      if (handler) {
        try {
          // req.body est notre data
          const result = await handler(null, req.body);
          res.json(result || { success: true });
        } catch (e) {
          res.status(500).json({ success: false, error: e.message });
        }
      } else {
        res.status(404).json({ success: false, error: `Action ${action} not found` });
      }
    });

    companion.app.get('/api/events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const onStatus = (data) => res.write(`data: ${JSON.stringify({ type: 'status-update', data })}\n\n`);
      const onDebug = (msg) => res.write(`data: ${JSON.stringify({ type: 'debug-log', data: msg })}\n\n`);

      const onBroadcast = ({ event, data }) => {
        if (event === 'STATUS' || event === 'STATUS_UPDATE') {
          onStatus({ ...data, service: 'tunneld' })
        } else if (event === 'LOCATION') {
          onStatus({ data, service: 'location' })
        }
      }

      companion.on('broadcast', onBroadcast)
      
      const logger = require('./logger')
      logger._headlessEventSubscribers = logger._headlessEventSubscribers || []
      logger._headlessEventSubscribers.push({ onStatus, onDebug })

      req.on('close', () => {
        companion.off('broadcast', onBroadcast)
        logger._headlessEventSubscribers = logger._headlessEventSubscribers.filter(sub => sub.onStatus !== onStatus)
      })
    });

    // On expose également le dashboard statique (React/Vite)
    // Les assets sont générés dans dist-web/assets, et le HTML dans dist-web/renderer-v2
    const webDistRoot = path.join(__dirname, '..', '..', 'dist-web');
    companion.app.use(express.static(webDistRoot));
    
    // Route de secours pour le SPA (Single Page Application)
    companion.app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(webDistRoot, 'renderer-v2', 'index.html'));
    });

    // 2. Initialiser le simulateur GPS
    dbg('[server] Initialisation du simulateur GPS...');
    // gps n'a pas de méthode init() - il s'initialise dans le constructeur

    // Liaison Tunnel -> Companion (comme dans window.js)
    tunnelManager.on('ready', () => companion.updateTunnelStatus(true));
    tunnelManager.on('lost', () => companion.updateTunnelStatus(false));

    gps.on('location-changed', ({ lat, lon, name }) => {
      companion.broadcastLocation(lat, lon, name)
      companion.confirmLocationApplied(lat, lon, name)
    })

    companion.on('request-location', ({ lat, lon, name }) => {
      gps.setLocation(lat, lon, name || "Position iPhone")
    })

    // 3. Gérer la logique de reconnexion automatique
    companion.on('iphone-ip-detected', (ip) => {
      dbg(`[server] 📱 iPhone détecté à l'IP : ${ip}. Mise à jour des réglages...`);
      const current = require('./services/settings-manager').get();
      require('./services/settings-manager').save({ ...current, wifiIp: ip });
      tunnelManager.applySettings();
    });

    // Lancement du companion server si pas en autonome
    const initialSettings = require('./services/settings-manager').get();
    if (initialSettings.operationMode !== 'autonomous') {
      companion.start(initialSettings.companionPort || 8080);
    }

    // 4. Lancer les drivers de tunnel
    dbg('[server] Lancement des services tunneld...');
    tunnelManager.start();

    dbg('[server] ✅ Serveur prêt et accessible sur le port 8080');
    
  } catch (err) {
    console.error('[CRITICAL ERROR] Échec du démarrage du serveur :', err);
    process.exit(1);
  }
}

// Gestion propre de l'arrêt
process.on('SIGINT', async () => {
  dbg('[server] Arrêt du serveur...');
  await tunnelManager.stopTunneld();
  process.exit(0);
});

startServer();
