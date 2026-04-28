const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gps', {
  setLocation:   (lat, lon, name) => ipcRenderer.invoke('set-location', { lat, lon, name }),
  clearLocation: () => ipcRenderer.invoke('clear-location'),
  playRoute:     (data) => ipcRenderer.invoke('play-route', data),
  playOsrmRoute: (data) => ipcRenderer.invoke('play-osrm-route', data),
  openGpxDialog: () => ipcRenderer.invoke('dialog:openGpx'),
  playCustomGpx: (data) => ipcRenderer.invoke('play-custom-gpx', data),
  getStatus:     () => ipcRenderer.invoke('get-status'),
  onStatus:      (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('status-update', listener);
    return () => ipcRenderer.removeListener('status-update', listener);
  },
  onDebug:       (cb) => ipcRenderer.on('debug-log', (_e, msg) => cb(msg)),
  openLogs:      () => ipcRenderer.invoke('open-logs'),
  restartTunnel: () => ipcRenderer.invoke('restart-tunnel'),

  // Paramètres
  getSettings:   () => ipcRenderer.invoke('get-settings'),
  saveSettings:  (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // Favoris
  addFavorite:   (fav) => ipcRenderer.invoke('add-favorite', fav),
  removeFavorite:(lat, lon) => ipcRenderer.invoke('remove-favorite', { lat, lon }),
  renameFavorite:(lat, lon, newName) => ipcRenderer.invoke('rename-favorite', { lat, lon, newName }),

  // Gestion des certificats (.plist)
  importPlist:   (data) => ipcRenderer.invoke('import-plist', data),
  listPlists:    () => ipcRenderer.invoke('list-plists'),
  deletePlist:   (name) => ipcRenderer.invoke('delete-plist', name),
  
  // Diagnostics et Maintenance
  runDiag:       (type) => ipcRenderer.invoke('diag:run', type),
  startDriver:   (driverId) => ipcRenderer.invoke('diag:start-driver', { value: driverId }),
  stopDriver:    (driverId) => ipcRenderer.invoke('diag:stop-driver', { value: driverId }),
  stopTunnels:   () => ipcRenderer.invoke('diag:stop-tunnels'),
  takeoverCluster: () => ipcRenderer.invoke('takeover-cluster'),
  getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),
  getCompanionQr: () => ipcRenderer.invoke('get-companion-qr'),

  // Événements
  onStatus:      (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('status-update', listener);
    return () => ipcRenderer.removeListener('status-update', listener);
  },
  onSettingsUpdated: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('settings-updated', listener);
    return () => ipcRenderer.removeListener('settings-updated', listener);
  },
  onEvent: (event, cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  }
})
