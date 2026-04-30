/**
 * GPS Bridge Polyfill
 * Fournit une interface unifiée entre Electron (IPC) et le mode Web (REST).
 */

import axios from 'axios';

const isElectron = !!(window && window.process && window.process.type) || !!(window.gps && window.gps.isElectron);

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
    
    // Listeners (Simulés via polling ou SSE si besoin)
    onStatus: (cb) => {
      // Pour le mode web, on pourrait utiliser des WebSockets ou SSE
      // Ici on simule un abonnement vide pour éviter les crashs
      return () => {}; 
    },
    onSettingsUpdated: (cb) => {
      return () => {};
    },
    
    // GPX (Plus complexe en Web, nécessite une gestion de fichiers via input HTML)
    openGpxDialog: () => Promise.resolve({ success: false, error: 'Non supporté en mode Web' }),
    playCustomGpx: () => Promise.resolve({ success: false })
  };
}

export default gps;
