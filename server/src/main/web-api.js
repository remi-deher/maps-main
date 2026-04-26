if (!window.gps) {
  console.log('[Web API] Initialisation du pont HTTP (Mode Docker/Headless)');

  const listeners = {
    status: new Set(),
    debug: new Set()
  };

  const eventSource = new EventSource('/api/events');
  eventSource.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.type === 'status-update') {
        listeners.status.forEach(cb => cb(payload.data));
      } else if (payload.type === 'debug-log') {
        listeners.debug.forEach(cb => cb(payload.data));
      }
    } catch (err) {}
  };

  async function invoke(action, data = {}) {
    try {
      const res = await fetch(`/api/ipc/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      console.error(`[Web API] Erreur IPC ${action}:`, e);
      return { success: false, error: e.message };
    }
  }

  window.gps = {
    setLocation:   (lat, lon, name) => invoke('set-location', { lat, lon, name }),
    clearLocation: () => invoke('clear-location'),
    playRoute:     (data) => invoke('play-route', data),
    playOsrmRoute: (data) => invoke('play-osrm-route', data),
    openGpxDialog: () => invoke('dialog:openGpx'),
    playCustomGpx: (data) => invoke('play-custom-gpx', data),
    playSequence:  (legs) => invoke('play-sequence', legs),
    getStatus:     () => invoke('get-status'),
    onStatus:      (cb) => {
      listeners.status.add(cb);
      return () => listeners.status.delete(cb);
    },
    onDebug:       (cb) => {
      listeners.debug.add(cb);
      return () => listeners.debug.delete(cb);
    },
    openLogs:      () => invoke('open-logs'),
    restartTunnel: () => invoke('restart-tunnel'),

    getNetworkInterfaces: () => invoke('get-network-interfaces'),
    getCompanionQr: () => invoke('get-companion-qr'),
    importPlist:   (data) => invoke('import-plist', data),
    listPlists:    () => invoke('list-plists'),
    deletePlist:   (name) => invoke('delete-plist', name),

    getSettings:   () => invoke('get-settings'),
    saveSettings:  (settings) => invoke('save-settings', settings),
    
    addFavorite:   (fav) => invoke('add-favorite', fav),
    removeFavorite:(lat, lon) => invoke('remove-favorite', { lat, lon }),
    renameFavorite:(lat, lon, newName) => invoke('rename-favorite', { lat, lon, newName })
  };
}
