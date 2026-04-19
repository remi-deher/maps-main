const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gps', {
  setLocation:   (lat, lon) => ipcRenderer.invoke('set-location', { lat, lon }),
  clearLocation: () => ipcRenderer.invoke('clear-location'),
  getStatus:     () => ipcRenderer.invoke('get-status'),
  onStatus:      (cb) => ipcRenderer.on('status-update', (_e, data) => cb(data)),
  onDebug:       (cb) => ipcRenderer.on('debug-log', (_e, msg) => cb(msg)),
  openLogs:      () => ipcRenderer.invoke('open-logs'),

  // Paramètres WiFi
  getSettings:   () => ipcRenderer.invoke('get-settings'),
  saveSettings:  (settings) => ipcRenderer.invoke('save-settings', settings),
})
