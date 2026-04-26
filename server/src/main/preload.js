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
})
