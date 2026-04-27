const { contextBridge, ipcRenderer } = require('electron')

console.log('[Preload] Initialisation du pont IPC...');

try {
  contextBridge.exposeInMainWorld('gps', {
    setLocation:   (lat, lon, name) => ipcRenderer.invoke('set-location', { lat, lon, name }),
    clearLocation: () => ipcRenderer.invoke('clear-location'),
    playRoute:     (data) => ipcRenderer.invoke('play-route', data),
    playOsrmRoute: (data) => ipcRenderer.invoke('play-osrm-route', data),
    openGpxDialog: () => ipcRenderer.invoke('dialog:openGpx'),
    playCustomGpx: (data) => ipcRenderer.invoke('play-custom-gpx', data),
    playSequence:  (legs) => ipcRenderer.invoke('play-sequence', legs),
    getStatus:     () => ipcRenderer.invoke('get-status'),
    onStatus:      (cb) => {
      const listener = (_e, data) => cb(data)
      ipcRenderer.on('status-update', listener)
      return () => ipcRenderer.removeListener('status-update', listener)
    },
    onDebug:       (cb) => ipcRenderer.on('debug-log', (_e, msg) => cb(msg)),
    openLogs:      () => ipcRenderer.invoke('open-logs'),
    restartTunnel: () => ipcRenderer.invoke('restart-tunnel'),

    // Favoris & Historique
    getSettings:   () => ipcRenderer.invoke('get-settings'),
    saveSettings:  (settings) => ipcRenderer.invoke('save-settings', settings),
    addFavorite:   (fav) => ipcRenderer.invoke('add-favorite', fav),
    removeFavorite: (lat, lon) => ipcRenderer.invoke('remove-favorite', { lat, lon }),
    renameFavorite: (lat, lon, newName) => ipcRenderer.invoke('rename-favorite', { lat, lon, newName }),
    getCompanionQr: () => ipcRenderer.invoke('get-companion-qr'),
    getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),
    onSettingsUpdated: (cb) => {
      const listener = (_e, data) => cb(data)
      ipcRenderer.on('settings-updated', listener)
      return () => ipcRenderer.removeListener('settings-updated', listener)
    },

    // Gestion des certificats (.plist)
    importPlist:   (data) => ipcRenderer.invoke('import-plist', data),
    listPlists:    () => ipcRenderer.invoke('list-plists'),
    deletePlist:   (name) => ipcRenderer.invoke('delete-plist', name),
  })
  console.log('[Preload] Pont IPC exposé avec succès.');
} catch (err) {
  console.error('[Preload] Erreur lors de l\'exposition du pont :', err);
}
