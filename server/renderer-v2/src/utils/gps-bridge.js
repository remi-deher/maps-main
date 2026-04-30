/**
 * GPS Bridge Polyfill
 * Fournit une interface unifiée entre Electron (IPC) et le mode Web (REST).
 */

import axios from 'axios';

const isElectron = !!(window.gps && window.gps.isElectron);

let gps = window.gps;

if (!isElectron) {
  console.log('[gps-bridge] 🌐 Mode Web détecté, activation du polyfill REST');
  
  gps = {
    isElectron: false,
    
    getStatus: () => axios.get('/api/status').then(r => r.data),
    getSettings: () => axios.get('/api/settings').then(r => r.data),
    saveSettings: (s) => axios.post('/api/settings', s).then(r => r.data),
    
    setLocation: (lat, lon, name) => axios.post('/api/location/set', { lat, lon, name }).then(r => r.data),
    clearLocation: () => axios.post('/api/location/clear').then(r => r.data),
    
    listPmd3Devices: () => axios.get('/api/diagnostic/pmd3-devices').then(r => r.data).catch(() => []),
    restartTunnel: () => axios.post('/api/diagnostic/restart-tunnel').then(r => r.data),
    getNetworkInterfaces: () => axios.get('/api/diagnostic/interfaces').then(r => r.data).catch(() => []),
    getCompanionQr: () => axios.get('/api/diagnostic/qr').then(r => r.data),
    listPlists: () => axios.get('/api/diagnostic/plists').then(r => r.data).catch(() => ({ plists: [] })),
    
    // Listeners (Nop en mode Web pur, à moins d'utiliser du polling ou WS)
    onStatus: (cb) => { return () => {} },
    onSettingsUpdated: (cb) => { return () => {} },
    onEvent: (name, cb) => { return () => {} },
    
    openGpxDialog: () => Promise.resolve({ success: false, error: 'Non supporté en mode Web' }),
    playCustomGpx: () => Promise.resolve({ success: false })
  };
  window.gps = gps;
}

if (!gps) {
    gps = { isElectron: false, getStatus: () => Promise.resolve({}), onStatus: () => () => {} };
}

export default gps;
