/**
 * GPS Bridge Polyfill
 * Fournit une interface unifiée entre Electron (IPC) et le mode Web (REST).
 */

import axios from 'axios';
import { io } from 'socket.io-client';

const isElectron = !!(window.gps && window.gps.isElectron);

let gps = window.gps;

if (!isElectron) {
  console.log('[gps-bridge] 🌐 Mode Web détecté, activation du polyfill REST + WebSocket');
  
  const socket = io(); // Se connecte au même host/port que l'UI
  
  gps = {
    isElectron: false,
    
    getStatus: () => axios.get('/api/status').then(r => r.data),
    getSettings: () => axios.get('/api/settings').then(r => r.data),
    saveSettings: (s) => axios.post('/api/settings', s).then(r => r.data),
    
    setLocation: (lat, lon, name) => axios.post('/api/location/set', { lat, lon, name }).then(r => r.data),
    clearLocation: () => axios.post('/api/location/clear').then(r => r.data),
    addFavorite: (fav) => axios.post('/api/favorites/add', fav).then(r => r.data),
    removeFavorite: (lat, lon) => axios.post('/api/favorites/remove', { lat, lon }).then(r => r.data),
    renameFavorite: (lat, lon, newName) => axios.post('/api/favorites/rename', { lat, lon, newName }).then(r => r.data),
    
    listDevices: () => axios.get('/api/diagnostic/devices').then(r => r.data).catch(() => []),
    restartTunnel: () => axios.post('/api/diagnostic/restart-tunnel').then(r => r.data),
    getNetworkInterfaces: () => axios.get('/api/diagnostic/interfaces').then(r => r.data).catch(() => []),
    getCompanionQr: () => axios.get('/api/diagnostic/qr').then(r => r.data),
    listPlists: () => axios.get('/api/diagnostic/plists').then(r => r.data).catch(() => ({ plists: [] })),
    
    onStatus: (cb) => {
      socket.on('STATUS', cb);
      socket.on('STATUS_UPDATE', (data) => cb({ service: 'tunneld', ...data }));
      socket.on('status-update', cb);
      socket.on('debug-log', (msg) => cb({ service: 'server-log', data: msg }));
      socket.on('LOCATION', (data) => cb({ service: 'location', data }));
      return () => {
        socket.off('STATUS');
        socket.off('STATUS_UPDATE');
        socket.off('status-update');
        socket.off('debug-log');
        socket.off('LOCATION');
      };
    },
    onSettingsUpdated: (cb) => {
      socket.on('settings-updated', cb);
      return () => socket.off('settings-updated');
    },
    onEvent: (name, cb) => {
      socket.on(name, cb);
      return () => socket.off(name);
    },
    
    openGpxDialog: () => Promise.resolve({ success: false, error: 'Non supporté en mode Web' }),
    playCustomGpx: () => Promise.resolve({ success: false }),
    playRoute: (data) => axios.post('/api/location/route', data).then(r => r.data),
    playOsrmRoute: (data) => axios.post('/api/location/route/osrm', data).then(r => r.data),
    playSequence: (legs) => axios.post('/api/location/sequence', { legs }).then(r => r.data),
    setSequencerLoop: (enabled) => axios.post('/api/location/sequence/loop', { enabled }).then(r => r.data),
    syncSequencePreview: (points) => axios.post('/api/location/sequence/sync-preview', { points }).then(r => r.data).catch(() => ({}))
  };
  window.gps = gps;
}

if (!gps) {
    gps = { isElectron: false, getStatus: () => Promise.resolve({}), onStatus: () => () => {} };
}

export default gps;
