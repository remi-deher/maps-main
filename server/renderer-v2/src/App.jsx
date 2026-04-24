import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Settings, History, Star, QrCode, Monitor, Search, X, Navigation, RotateCcw, Edit2, Trash2, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MapView from './components/MapView';
import SettingsModal from './components/SettingsModal';
import QrModal from './components/QrModal';
import LogsModal from './components/LogsModal';
import { useStorage } from './hooks/useStorage';
import { useSearch } from './hooks/useSearch';

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
  
  const searchInputRef = useRef(null);
  const { history, favorites, addToHistory, addFavorite, removeFavorite } = useStorage();

  const isFavorite = (lat, lon) => favorites.some(f => Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001);
  const toggleFavorite = async (pos) => {
    if (isFavorite(pos.lat, pos.lon)) {
      await window.gps.removeFavorite(pos.lat, pos.lon);
    } else {
      await window.gps.addFavorite({ name: pos.name || "Lieu favori", lat: pos.lat, lon: pos.lon });
    }
  };

  const renameFavorite = async (fav) => {
    const newName = prompt("Nouveau nom pour ce lieu :", fav.name);
    if (newName && newName.trim()) {
      await window.gps.renameFavorite(fav.lat, fav.lon, newName.trim());
    }
  };

  const handleDeleteFavorite = async (fav) => {
    if (confirm(`Supprimer "${fav.name}" des favoris ?`)) {
      await window.gps.removeFavorite(fav.lat, fav.lon);
    }
  };

  const { search, results, loading, reverseGeocode, setResults } = useSearch();

  useEffect(() => {
    window.gps.getStatus().then(data => {
      if (data.tunnelReady) {
        setStatus({ state: 'ready', message: 'iPhone connecté', type: data.connectionType, device: data.deviceInfo });
      }
    });

    const removeListener = window.gps.onStatus((data) => {
      const timestamp = new Date().toLocaleTimeString();

      if (data.service === 'tunneld') {
        setStatus(prev => ({ 
          ...prev, 
          state: data.state, 
          message: data.message, 
          type: data.type || prev.type,
          device: data.device || prev.device
        }));
        setServerLogs(prev => [{ timestamp, message: `[TNL] ${data.message}`, type: data.state }, ...prev].slice(0, 500));
      } else if (data.service === 'client-log') {
        setClientLogs(prev => [data.data, ...prev].slice(0, 500));
      } else if (data.service === 'server-log') {
        setServerLogs(prev => [{ timestamp, message: data.data, type: 'info' }, ...prev].slice(0, 500));
      } else if (data.service === 'location') {
        // Synchronisation du marqueur quand l'iPhone change la position
        const { lat, lon, name } = data.data;
        setActiveSim({ lat, lon, name });
      }
    });

    return () => removeListener();
  }, []);

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
    const res = await window.gps.setLocation(selectedPos.lat, selectedPos.lon, selectedPos.name);
    if (res.success) {
      setActiveSim(selectedPos);
      addToHistory(selectedPos);
      setSelectedPos(null);
    }
  };

  const resetLocation = async () => {
    await window.gps.clearLocation();
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
        <MapView onMapClick={handleMapClick} selectedPos={selectedPos || activeSim} />
      </div>

      {/* Sidebar, Settings, etc. */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSidebarOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[60]" />
            <motion.div initial={{ x: -400 }} animate={{ x: 0 }} exit={{ x: -400 }} className="absolute top-0 left-0 bottom-0 w-96 glass-dark z-[70] shadow-2xl p-6 flex flex-col">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">Global Mock</h2>
                <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors"><X className="w-6 h-6" /></button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-8 pr-2 custom-scrollbar">
                {/* DEVICE INFO SECTION */}
                <section>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-400 mb-3 px-2">
                    <Monitor className="w-4 h-4 text-emerald-400" /> <span>APPAREIL</span>
                  </div>
                  <div className="mx-2 p-4 rounded-2xl bg-white/5 border border-white/5 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500 uppercase tracking-wider">Modèle</span>
                      <span className="text-sm font-bold text-white">{status.device?.type || 'iPhone'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500 uppercase tracking-wider">IP / RSD</span>
                      <span className="text-sm font-mono text-blue-300">{status.type === 'USB' ? 'USB Native' : (status.device?.ip || '192.168.x.x')}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-white/5">
                      <span className="text-xs text-slate-500 uppercase tracking-wider">Connexion</span>
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {status.type || 'Attente...'}
                      </span>
                    </div>
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
              <div className="mt-auto pt-6 border-t border-white/5 flex gap-2">
                <button onClick={() => {setSettingsOpen(true); setSidebarOpen(false);}} className="flex-1 h-12 glass hover:bg-white/10 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
                  <Settings className="w-5 h-5" /> <span className="text-sm">Réglages</span>
                </button>
                <button onClick={() => {setQrOpen(true); setSidebarOpen(false);}} className="flex-1 h-12 glass hover:bg-white/10 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
                  <QrCode className="w-5 h-5" /> <span className="text-sm">QR Code</span>
                </button>
              </div>
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
              <button onClick={teleport} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-900/20"><Navigation className="w-5 h-5" /> Allez ici</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Pill (Bottom) */}
      <div className="absolute bottom-8 right-8 z-50">
        <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className={`flex items-center gap-4 px-6 py-3 rounded-2xl glass-dark border-l-4 ${status.state === 'ready' ? 'border-l-emerald-500' : 'border-l-blue-500'} shadow-xl`}>
          <div className={`w-3 h-3 rounded-full ${status.state === 'ready' ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse'}`} />
          <p className="font-bold text-sm leading-none">{status.message}</p>
        </motion.div>
      </div>

      {/* 🛡️ OMNIBAR 🛡️ */}
      <div 
        className="absolute top-6 left-0 right-0 mx-auto w-full max-w-2xl z-[10000] px-6"
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
          <Monitor className="w-6 h-6 text-blue-300 cursor-pointer" onClick={(e) => { e.stopPropagation(); setSidebarOpen(true); }} />
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
          <div className="flex items-center gap-2">
            <Terminal className="w-6 h-6 text-blue-400 cursor-pointer hover:text-blue-300 transition-colors" onClick={(e) => { e.stopPropagation(); setLogsOpen(true); }} />
            <QrCode className="w-6 h-6 text-slate-300 cursor-pointer hover:text-white transition-colors" onClick={(e) => { e.stopPropagation(); setQrOpen(true); }} />
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
