const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gps', {
  setLocation:   (lat, lon, name) => ipcRenderer.invoke('set-location', { lat, lon, name }),
  clearLocation: () => ipcRenderer.invoke('clear-location'),
  getStatus:     () => ipcRenderer.invoke('get-status'),
  onStatus:      (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('status-update', listener)
    return () => ipcRenderer.removeListener('status-update', listener)
  },
  onDebug:       (cb) => ipcRenderer.on('debug-log', (_e, msg) => cb(msg)),
  openLogs:      () => ipcRenderer.invoke('open-logs'),

  // Paramètres WiFi
  getSettings:   () => ipcRenderer.invoke('get-settings'),
  saveSettings:  (settings) => ipcRenderer.invoke('save-settings', settings),
  getCompanionQr: () => ipcRenderer.invoke('get-companion-qr'),
})
