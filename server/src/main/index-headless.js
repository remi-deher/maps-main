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
        handleOnce: (channel, listener) => { ipcHandlers[channel] = listener; },
        removeHandler: (channel) => { delete ipcHandlers[channel]; },
        on: (channel, listener) => { ipcHandlers[channel] = listener; },
        off: (channel) => { delete ipcHandlers[channel]; }
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
  return originalRequire.call(this, id);
};

const { dbg } = require('./logger');

// Chargement des services
const CompanionServer = require('./services/companion-server');
const tunnelManager = require('./tunneld-manager');
const GpsSimulator = require('./services/gps/gps-simulator');
const clusterManager = require('./services/cluster-manager');
const { registerIpcHandlers } = require('./ipc/registry');

dbg('-------------------------------------------');
dbg('   GPS MOCK SERVER - MODE HEADLESS (DOCKER)  ');
dbg('-------------------------------------------');

async function startServer() {
  try {
    dbg('[server] Initialisation des services...');
    
    const companion = new CompanionServer(tunnelManager);
    const gps = new GpsSimulator(tunnelManager, companion);

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
          dbg(`[api] IPC Action: ${action} | Data: ${JSON.stringify(req.body)}`);
          // Mock de l'objet event d'Electron
          const mockEvent = {
            sender: {
              send: (channel, data) => {
                if (channel === 'settings-updated') {
                  companion.emit('settings-updated', data);
                } else {
                  // Relais générique vers SSE
                  companion.emit('broadcast', { event: channel, data });
                }
              }
            }
          };
          
          const result = await handler(mockEvent, req.body);
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
      const onSettings = (data) => res.write(`data: ${JSON.stringify({ type: 'settings-updated', data })}\n\n`);

      const onBroadcast = ({ event, data }) => {
        if (event === 'STATUS' || event === 'STATUS_UPDATE') {
          onStatus({ ...data, service: 'tunneld' })
        } else if (event === 'LOCATION') {
          onStatus({ data, service: 'location' })
        }
      }

      companion.on('broadcast', onBroadcast)
      companion.on('settings-updated', onSettings)
      
      const logger = require('./logger')
      logger._headlessEventSubscribers = logger._headlessEventSubscribers || []
      logger._headlessEventSubscribers.push({ onStatus, onDebug, onSettings })

      req.on('close', () => {
        companion.off('broadcast', onBroadcast)
        companion.off('settings-updated', onSettings)
        logger._headlessEventSubscribers = logger._headlessEventSubscribers.filter(sub => sub.onStatus !== onStatus)
      })
    });

    // Dashboard statique
    const fs = require('fs');
    let webDistRoot = path.join(__dirname, '..', '..', 'dist-web');
    if (!fs.existsSync(webDistRoot)) {
      webDistRoot = path.join(__dirname, '..', '..', '..', 'dist-web');
    }
    
    dbg(`[server] Dashboard servi depuis : ${webDistRoot}`);
    companion.app.use(express.static(webDistRoot));
    
    companion.app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(webDistRoot, 'renderer-v2', 'index.html'));
    });

    // Liaison Tunnel -> Companion
    tunnelManager.on('ready', () => companion.updateTunnelStatus(true));
    tunnelManager.on('lost', () => companion.updateTunnelStatus(false));

    gps.on('location-changed', ({ lat, lon, name }) => {
      companion.broadcastLocation(lat, lon, name)
      companion.confirmLocationApplied(lat, lon, name)
    })

    companion.on('request-location', ({ lat, lon, name }) => {
      gps.setLocation(lat, lon, name || "Position iPhone")
    })

    companion.on('iphone-ip-detected', (ip) => {
      const current = require('./services/settings-manager').get();
      if (current.wifiIp === ip) return;

      dbg(`[server] 📱 iPhone détecté à l'IP : ${ip}. Mise à jour de l'IP WiFi...`);
      require('./services/settings-manager').save({ ...current, wifiIp: ip });
      
      if (!tunnelManager.getRsdAddress()) {
        tunnelManager.applySettings();
      }
    });

    // --- LOGIQUE CLUSTER (HEADLESS) ---
    clusterManager.on('role-changed', (role) => {
      dbg(`[server] 🎭 Changement de rôle Cluster : ${role.toUpperCase()}`);
      if (role === 'master') {
        const currentSettings = require('./services/settings-manager').get();
        if (currentSettings.operationMode !== 'autonomous') {
          companion.start(currentSettings.companionPort || 8080);
        }
        tunnelManager.start();
      } else {
        tunnelManager.stopTunneld();
        companion.stop();
      }
    });

    // Synchro Slave
    companion.on('cluster-sync', ({ lat, lon, name }) => {
      if (clusterManager.role === 'slave') {
        gps.lastCoords = { lat, lon, name };
      }
    });

    // --- DÉMARRAGE DES SERVICES ---
    const initialSettings = require('./services/settings-manager').get();
    
    // Initialisation forcée du rôle master si cluster désactivé (centralisé dans ClusterManager)
    await clusterManager.init();

    if (clusterManager.role === 'master') {
      dbg('[server] Rôle MAÎTRE détecté. Lancement des services...');
      if (initialSettings.operationMode !== 'autonomous') {
        companion.start(initialSettings.companionPort || 8080);
      }
      tunnelManager.start();
    } else {
      dbg('[server] Rôle ESCLAVE détecté. En attente du Maître...');
    }

    dbg('[server] ✅ Serveur initialisé');
    
  } catch (err) {
    console.error('[CRITICAL ERROR] Échec du démarrage du serveur :', err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  dbg('[server] Arrêt du serveur...');
  await tunnelManager.stopTunneld();
  process.exit(0);
});

startServer();
