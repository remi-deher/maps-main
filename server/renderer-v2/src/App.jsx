import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Settings, History, Star, QrCode, Monitor, Search, X, Navigation, RotateCcw, Edit2, Trash2, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MapView from './components/MapView';
import SettingsModal from './components/SettingsModal';
import QrModal from './components/QrModal';
import LogsModal from './components/LogsModal';
import { useStorage } from './hooks/useStorage';
import { useSearch } from './hooks/useSearch';
import gps from './utils/gps-bridge';

function App() {
  const [status, setStatus] = useState({ state: 'starting', message: 'Initialisation...', type: null, device: null });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [selectedPos, setSelectedPos] = useState(null);
  const [activeSim, setActiveSim] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [clientLogs, setClientLogs] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  
  const [deviceList, setDeviceList] = useState([]);
  const searchInputRef = useRef(null);
  const { history, favorites, addToHistory, addFavorite, removeFavorite } = useStorage();

  const fetchDevices = () => {
    gps.listPmd3Devices().then(setDeviceList);
  };

  const isFavorite = (lat, lon) => favorites.some(f => Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001);
  const toggleFavorite = async (pos) => {
    if (isFavorite(pos.lat, pos.lon)) {
      await gps.removeFavorite(pos.lat, pos.lon);
    } else {
      await gps.addFavorite({ name: pos.name || "Lieu favori", lat: pos.lat, lon: pos.lon });
    }
  };

  const renameFavorite = async (fav) => {
    const newName = prompt("Nouveau nom pour ce lieu :", fav.name);
    if (newName && newName.trim()) {
      await gps.renameFavorite(fav.lat, fav.lon, newName.trim());
    }
  };

  const handleDeleteFavorite = async (fav) => {
    if (confirm(`Supprimer "${fav.name}" des favoris ?`)) {
      await gps.removeFavorite(fav.lat, fav.lon);
    }
  };

  const { search, results, loading, reverseGeocode, setResults } = useSearch();

  useEffect(() => {
    const refreshStatus = () => {
      gps.getStatus().then(data => {
        setStatus(prev => ({ 
          ...prev,
          operationMode: data.operationMode,
          state: data.tunnelActive ? data.state : prev.state,
          message: data.tunnelActive ? (data.state === 'running' ? 'Simulation active' : 'iPhone prêt') : prev.message,
          type: data.connectionType || prev.type,
          device: data.deviceInfo || prev.device,
          verified: data.state === 'running'
        }));
      });
    };

    refreshStatus();

    const removeStatusListener = gps.onStatus((data) => {
      const timestamp = new Date().toLocaleTimeString();

      if (data.service === 'tunneld') {
        const isVerified = data.state === 'running';
        setStatus(prev => ({ 
          ...prev, 
          state: data.state, 
          message: data.state === 'running' ? 'Simulation active' : (data.state === 'ready' ? 'iPhone prêt' : data.message), 
          type: data.type || prev.type,
          device: data.device || prev.device,
          verified: isVerified
        }));
        setServerLogs(prev => [{ timestamp, message: `[TNL] ${data.message}`, type: data.state }, ...prev].slice(0, 500));
      } else if (data.service === 'client-log') {
        const enrichedLog = { ...data.data, timestamp };
        setClientLogs(prev => [enrichedLog, ...prev].slice(0, 500));
      } else if (data.service === 'server-log') {
        setServerLogs(prev => [{ timestamp, message: data.data, type: 'info' }, ...prev].slice(0, 500));
      } else if (data.service === 'location') {
        const { lat, lon, name } = data.data;
        setActiveSim({ lat, lon, name });
        setStatus(prev => ({ ...prev, verified: true, state: 'running', message: 'Simulation active' }));
      }
    });

    const removeSettingsListener = gps.onSettingsUpdated(() => {
      refreshStatus();
    });

    return () => {
      removeStatusListener();
      removeSettingsListener();
    };
  }, []);

  useEffect(() => {
    if (sidebarOpen) {
      fetchDevices();
    }
  }, [sidebarOpen]);

  const handleMapClick = async (lat, lon) => {
    const name = await reverseGeocode(lat, lon);
    setSelectedPos({ lat, lon, name });
  };

  const selectLocation = (loc) => {
    setSelectedPos({ lat: loc.lat, lon: loc.lon, name: loc.name });
    setResults([]);
    setSearchQuery('');
  };

  const teleport = async () => {
    if (!selectedPos) return;
    const res = await gps.setLocation(selectedPos.lat, selectedPos.lon, selectedPos.name);
    if (res.success) {
      setActiveSim(selectedPos);
      addToHistory(selectedPos);
      setSelectedPos(null);
    }
  };

  const playRoute = async (lat, lon) => {
    const endLat = lat || selectedPos?.lat;
    const endLon = lon || selectedPos?.lon;
    if (!endLat || !endLon) return;
    
    const speed = parseFloat(prompt("Vitesse (km/h) :", "5")) || 5;
    const res = await gps.playRoute({ endLat, endLon, speed });
    if (res.success) {
      setActiveSim({ lat: endLat, lon: endLon, name: "Navigation..." });
      setSelectedPos(null);
    }
  };

  const playOsrmRoute = async (lat, lon, profile = 'driving') => {
    const endLat = lat || selectedPos?.lat;
    const endLon = lon || selectedPos?.lon;
    if (!endLat || !endLon) return;
    
    const speedStr = profile === 'driving' ? "" : (profile === 'walking' ? "5" : "20");
    const speed = parseFloat(prompt(`Vitesse (km/h) [Profil: ${profile}] :`, speedStr)) || null;
    
    const res = await gps.playOsrmRoute({ endLat, endLon, profile, speed });
    if (res.success) {
      setActiveSim({ lat: endLat, lon: endLon, name: `Navigation (${profile})...` });
      setSelectedPos(null);
    }
  };

  const resetLocation = async () => {
    await gps.clearLocation();
    setSelectedPos(null);
    setActiveSim(null);
  };

  const handleContainerClick = (e) => {
    e.stopPropagation();
    window.focus();
    searchInputRef.current?.focus();
  };

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden text-slate-200">
      
      {/* Background Map */}
      <div className="absolute inset-0 z-0" tabIndex="-1" style={{ pointerEvents: 'auto' }}>
        <MapView onMapClick={handleMapClick} selectedPos={selectedPos || activeSim} onPlayRoute={playRoute} onPlayOsrmRoute={playOsrmRoute} />
      </div>

      {/* Sidebar, Settings, etc. */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSidebarOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[60]" />
            <motion.div initial={{ x: -400 }} animate={{ x: 0 }} exit={{ x: -400 }} className="absolute top-0 left-0 bottom-0 w-96 glass-dark z-[70] shadow-2xl p-6 flex flex-col">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent tracking-tight">GPS Mock</h2>
                <button 
                  onClick={() => setSidebarOpen(false)} 
                  className="p-2 hover:bg-white/10 rounded-xl transition-all hover:rotate-90 active:scale-90"
                >
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-8 pr-2 custom-scrollbar">

                {/* LISTE DES APPAREILS DÉTECTÉS */}
                <section>
                  <div className="flex items-center justify-between text-sm font-semibold text-slate-400 mb-3 px-2">
                    <div className="flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-blue-400" /> <span>APPAREILS</span>
                    </div>
                    <button onClick={fetchDevices} className="p-1 hover:bg-white/10 rounded-md transition-colors group">
                      <RotateCcw className="w-3.5 h-3.5 group-active:rotate-180 transition-transform" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {deviceList.length > 0 ? deviceList.map((dev, i) => (
                      <div key={i} className="mx-2 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-blue-500/30 transition-all group/dev">
                        <div className="flex justify-between items-start mb-1">
                          <p className="font-bold text-xs text-white truncate max-w-[140px]">{dev.DeviceName}</p>
                          <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase ${dev.ConnectionType === 'Network' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                            {dev.ConnectionType}
                          </span>
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-500">
                          <span>{dev.DeviceClass} {dev.ProductVersion}</span>
                          <span className="font-mono opacity-50">{dev.UniqueDeviceID.substring(0, 8)}...</span>
                        </div>
                      </div>
                    )) : (
                      <p className="px-4 py-2 text-center text-slate-600 italic text-[10px]">Aucun appareil détecté via usbmuxd</p>
                    )}
                  </div>
                </section>
                {/* FAVORIS SECTION */}
                <section>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-400 mb-3 px-2">
                    <Star className="w-4 h-4 text-amber-400" /> <span>FAVORIS</span>
                  </div>
                  <div className="space-y-1">
                    {favorites.length > 0 ? favorites.map((fav, i) => (
                      <div key={`fav-${i}`} className="group flex items-center gap-2 p-1">
                        <button 
                          onClick={() => {selectLocation(fav); setSidebarOpen(false);}} 
                          className="flex-1 p-3 rounded-xl hover:bg-white/5 transition-colors text-left flex items-center justify-between min-w-0"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium line-clamp-1">{fav.name}</p>
                            <p className="text-xs text-slate-500">{fav.lat.toFixed(4)}, {fav.lon.toFixed(4)}</p>
                          </div>
                          <Star className="w-4 h-4 text-amber-400 opacity-40 group-hover:opacity-100 transition-opacity" fill="currentColor" />
                        </button>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pr-2">
                          <button onClick={() => renameFavorite(fav)} className="p-2 hover:bg-blue-500/20 rounded-lg text-blue-400 transition-colors">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteFavorite(fav)} className="p-2 hover:bg-rose-500/20 rounded-lg text-rose-400 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )) : <p className="p-4 text-center text-slate-600 italic text-sm">Aucun favori</p>}
                  </div>
                </section>

                {/* RÉCENTS SECTION */}
                <section>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-400 mb-3 px-2">
                    <History className="w-4 h-4 text-blue-400" /> <span>HISTORIQUE RÉCENT</span>
                  </div>
                  <div className="space-y-1">
                    {history.length > 0 ? history.map((item, i) => (
                      <button key={`hist-${i}`} onClick={() => {selectLocation(item); setSidebarOpen(false);}} className="w-full p-3 rounded-xl hover:bg-white/5 transition-colors text-left group">
                        <p className="font-medium line-clamp-1">{item.name || "Position"}</p>
                        <p className="text-xs text-slate-500">{item.lat.toFixed(4)}, {item.lon.toFixed(4)}</p>
                      </button>
                    )) : <p className="p-4 text-center text-slate-600 italic text-sm">Aucun historique</p>}
                  </div>
                </section>

                {/* CONSOLE PREVIEW SECTION */}
                <section className="mt-auto pt-6">
                  <button 
                    onClick={() => {setLogsOpen(true); setSidebarOpen(false);}}
                    className="w-full group p-4 rounded-2xl bg-black/40 border border-white/5 hover:bg-white/5 transition-all flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 text-slate-400 group-hover:text-white transition-colors">
                      <Terminal className="w-5 h-5 text-blue-400" />
                      <span className="text-sm font-bold uppercase tracking-wider">Console Système</span>
                    </div>
                    <div className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold">
                      {serverLogs.length + clientLogs.length} LOGS
                    </div>
                  </button>
                </section>
              </div>
              <div className="mt-auto pt-6 border-t border-white/10 flex gap-3">
                <button 
                  onClick={() => {setSettingsOpen(true); setSidebarOpen(false);}} 
                  className="flex-1 h-12 glass-deeper hover:bg-white/10 rounded-xl font-bold transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 text-slate-300 hover:text-white"
                >
                  <Settings className="w-5 h-5" /> <span className="text-xs uppercase tracking-widest">Réglages</span>
                </button>
                <button 
                  onClick={() => {setQrOpen(true); setSidebarOpen(false);}} 
                  className="flex-1 h-12 glass-deeper hover:bg-white/10 rounded-xl font-bold transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 text-slate-300 hover:text-white"
                >
                  <QrCode className="w-5 h-5" /> <span className="text-xs uppercase tracking-widest">QR Code</span>
                </button>
              </div>
              <button 
                onClick={async () => {
                  const res = await gps.openGpxDialog();
                  if (res.success) {
                    const speed = parseFloat(prompt("Vitesse (km/h) - Laissez vide pour vitesse réelle :", ""));
                    await gps.playCustomGpx({ gpxContent: res.content, speed: isNaN(speed) ? null : speed });
                    setSidebarOpen(false);
                  }
                }} 
                className="w-full mt-4 h-12 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-emerald-500/20"
              >
                📁 Lancer GPX local
              </button>
              <button 
                onClick={() => {
                  alert("Le séquenceur multimodal sur PC sera disponible dans une prochaine mise à jour. Utilisez l'iPhone pour planifier vos étapes complexes.");
                }} 
                className="w-full mt-2 h-12 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-indigo-500/20"
              >
                ✈️ Séquenceur Voyage
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <QrModal isOpen={qrOpen} onClose={() => setQrOpen(false)} />
      <LogsModal 
        isOpen={logsOpen} 
        onClose={() => setLogsOpen(false)} 
        serverLogs={serverLogs} 
        clientLogs={clientLogs} 
        onClearServer={() => setServerLogs([])}
        onClearClient={() => setClientLogs([])}
      />

      {/* Action Pill (Bottom) */}
      <AnimatePresence>
        {selectedPos && (
          <motion.div initial={{ y: 50, opacity: 0, x: '-50%' }} animate={{ y: 0, opacity: 1, x: '-50%' }} exit={{ y: 50, opacity: 0, x: '-50%' }} className="absolute bottom-28 left-1/2 z-50 glass-dark px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-6 border border-white/10 min-w-[320px]">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-100 truncate">{selectedPos.name || "Lieu sélectionné"}</p>
              <p className="text-xs text-slate-400 font-mono">{selectedPos.lat}, {selectedPos.lon}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => toggleFavorite(selectedPos)} className={`p-3 glass hover:bg-white/10 rounded-2xl transition-colors ${isFavorite(selectedPos.lat, selectedPos.lon) ? 'text-amber-400' : 'text-slate-400'}`}>
                <Star className="w-5 h-5" fill={isFavorite(selectedPos.lat, selectedPos.lon) ? "currentColor" : "none"} />
              </button>
              <button onClick={resetLocation} className="p-3 glass hover:bg-white/10 rounded-2xl transition-colors text-slate-400"><RotateCcw className="w-5 h-5" /></button>
              <button onClick={() => playOsrmRoute(null, null, 'driving')} className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-indigo-900/20"><Navigation className="w-5 h-5" /> Conduire</button>
              <button onClick={() => playRoute()} className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-900/20"><Navigation className="w-5 h-5" /> Marcher</button>
              <button onClick={teleport} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-900/20"><MapPin className="w-5 h-5" /> Allez ici</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Pill (Bottom) */}
      <div className="absolute bottom-8 right-8 z-50">
        <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className={`flex items-center gap-4 px-6 py-3 rounded-2xl glass-dark border-l-4 ${status.verified ? 'border-l-emerald-500 bg-emerald-500/10' : (status.state === 'ready' ? 'border-l-blue-500' : 'border-l-slate-500')} shadow-xl`}>
          <div className={`w-3 h-3 rounded-full ${status.verified ? 'bg-emerald-500' : (status.state === 'ready' ? 'bg-blue-500 animate-pulse' : 'bg-slate-500')}`} />
          <p className="font-bold text-sm leading-none flex items-center gap-2">
            {status.message}
            {status.verified && <span className="text-emerald-400">✅</span>}
          </p>
        </motion.div>
      </div>

      {/* 🛡️ OMNIBAR 🛡️ */}
      <div 
        className="absolute top-6 left-0 right-0 mx-auto w-full max-w-2xl z-50 px-6"
        style={{ pointerEvents: 'none' }} 
      >
        <div 
          className="w-full glass-deeper rounded-2xl h-14 flex items-center px-4 gap-4 shadow-2xl cursor-text transition-none"
          style={{ 
            pointerEvents: 'auto', 
            WebkitAppRegion: 'no-drag',
            willChange: 'transform'
          }}
          onClick={handleContainerClick}
        >
          <Monitor className={`w-6 h-6 cursor-pointer transition-all hover:scale-110 active:scale-90 ${sidebarOpen ? 'text-blue-400' : 'text-blue-300/60'}`} onClick={(e) => { e.stopPropagation(); setSidebarOpen(!sidebarOpen); }} />
          <div className="relative flex-1 flex items-center h-full">
            <Search className="w-5 h-5 text-slate-300 absolute left-0 pointer-events-none" />
            <input 
              ref={searchInputRef}
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') search(searchQuery); }}
              placeholder="Rechercher..."
              spellCheck={false}
              autoComplete="off"
              className="w-full bg-transparent border-none outline-none text-lg pl-10 text-white font-bold placeholder:text-slate-400"
              style={{ 
                userSelect: 'text', 
                WebkitUserSelect: 'text',
                WebkitAppRegion: 'no-drag',
                pointerEvents: 'auto'
              }}
            />
          </div>
          <div className="flex items-center gap-3">
            {status.operationMode && (
              <div className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-tighter border ${
                status.operationMode === 'autonomous' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                status.operationMode === 'client-server' ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' :
                'bg-blue-500/10 text-blue-500 border-blue-500/20'
              }`}>
                {status.operationMode === 'autonomous' ? 'PC Only' : 
                 status.operationMode === 'client-server' ? 'Client Req' : 'Hybride'}
              </div>
            )}
            <Terminal 
              className={`w-5 h-5 cursor-pointer transition-all hover:scale-110 active:scale-90 ${logsOpen ? 'text-blue-400' : 'text-blue-300/40'}`} 
              onClick={(e) => { e.stopPropagation(); setLogsOpen(!logsOpen); }} 
            />
            <QrCode 
              className={`w-5 h-5 cursor-pointer transition-all hover:scale-110 active:scale-90 ${
                status.operationMode === 'autonomous' ? 'text-slate-700 pointer-events-none' :
                (qrOpen ? 'text-white' : 'text-slate-300/40')
              }`} 
              onClick={(e) => { e.stopPropagation(); setQrOpen(!qrOpen); }} 
            />
          </div>
        </div>

        {/* Results Dropdown */}
        <AnimatePresence>
          {results.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="w-full mt-2 glass-deeper rounded-2xl overflow-hidden shadow-2xl pointer-events-auto border border-white/5">
              {results.map((res, i) => (
                <button key={i} onClick={() => selectLocation(res)} className="w-full p-4 text-left hover:bg-white/10 border-b border-white/5 last:border-none flex items-start gap-4 transition-colors">
                  <MapPin className="w-5 h-5 mt-1 text-blue-400" />
                  <div>
                    <p className="font-bold text-white text-base line-clamp-1">{res.name}</p>
                    <p className="text-xs text-slate-400">{res.lat}, {res.lon}</p>
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default App;
