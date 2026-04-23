import React, { useState, useEffect } from 'react';
import { MapPin, Settings, History, Star, QrCode, Monitor, Search, X, Navigation, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MapView from './components/MapView';
import SettingsModal from './components/SettingsModal';
import QrModal from './components/QrModal';
import { useStorage } from './hooks/useStorage';
import { useSearch } from './hooks/useSearch';

function App() {
  const [status, setStatus] = useState({ state: 'starting', message: 'Initialisation...', type: null });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [selectedPos, setSelectedPos] = useState(null);
  const [activeSim, setActiveSim] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const { history, favorites, addToHistory, addFavorite, removeFavorite } = useStorage();

  const isFavorite = (lat, lon) => favorites.some(f => Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001);
  const toggleFavorite = async (pos) => {
    if (isFavorite(pos.lat, pos.lon)) {
      const idx = favorites.findIndex(f => Math.abs(f.lat - pos.lat) < 0.0001 && Math.abs(f.lon - pos.lon) < 0.0001);
      if (idx !== -1) await removeFavorite(idx);
    } else {
      await addFavorite({ name: pos.name || "Lieu favori", lat: pos.lat, lon: pos.lon });
    }
  };
  const { search, results, loading, reverseGeocode, setResults } = useSearch();

  useEffect(() => {
    window.gps.getStatus().then(data => {
      if (data.tunnelReady) {
        setStatus({ state: 'ready', message: 'iPhone connecté', type: data.connectionType });
      }
    });

    const removeListener = window.gps.onStatus((data) => {
      if (data.service === 'tunneld') {
        setStatus(prev => ({ ...prev, state: data.state, message: data.message, type: data.type || prev.type }));
      } else if (data.service === 'favorites') {
        // useStorage gère déjà le chargement, mais on force ici la mise à jour si besoin
        // Ou mieux, on pourrait simplement rafraîchir les réglages
      }
    });

    return () => removeListener();
  }, []);

  const handleMapClick = async (lat, lon) => {
    const name = await reverseGeocode(lat, lon);
    setSelectedPos({ lat, lon, name });
  };

  const handleSearch = (e) => {
    setSearchQuery(e.target.value);
    search(e.target.value);
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

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden text-slate-200">
      
      {/* Background Map */}
      <div className="absolute inset-0 z-0">
        <MapView onMapClick={handleMapClick} selectedPos={selectedPos || activeSim} />
      </div>

      {/* Top Floating Bar (Omnibar) - Version Simplifiée sans Animation */}
      <div 
        className="absolute top-6 left-1/2 -translate-x-1/2 w-full max-w-2xl z-[100] px-6"
        style={{ pointerEvents: 'auto' }}
      >
        <div 
          className="w-full bg-[#1a1a2e] border border-white/10 rounded-2xl h-14 flex items-center px-4 gap-4 shadow-2xl"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <button 
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-white/10 rounded-xl transition-colors"
          >
            <Monitor className="w-6 h-6 text-blue-300" />
          </button>
          
          <div className="relative flex-1 flex items-center h-full">
            <Search className="w-5 h-5 text-slate-300 absolute left-0" />
            <input 
              id="search-input"
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') search(searchQuery);
              }}
              placeholder="Rechercher un lieu..."
              spellCheck={false}
              autoComplete="off"
              className="w-full bg-transparent border-none outline-none text-lg pl-10 text-white font-bold placeholder:text-slate-400"
              style={{ 
                WebkitAppRegion: 'no-drag', 
                WebkitUserSelect: 'text',
                userSelect: 'text',
                cursor: 'text'
              }}
            />
          </div>

          <div className="w-px h-6 bg-white/10" />
          
          <button onClick={() => setQrOpen(true)} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <QrCode className="w-6 h-6 text-slate-300" />
          </button>
        </div>

        {/* Search Results Dropdown (Attached to Omnibar) */}
        <AnimatePresence>
          {results.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="w-full mt-2 glass-deeper rounded-2xl overflow-hidden shadow-2xl pointer-events-auto border border-white/5"
            >
              {results.map((res, i) => (
                <button 
                  key={i}
                  onClick={() => selectLocation(res)}
                  className="w-full p-4 text-left hover:bg-white/10 border-b border-white/5 last:border-none flex items-start gap-4 transition-colors"
                >
                  <MapPin className="w-5 h-5 mt-1 text-blue-400" />
                  <div>
                    <p className="font-bold text-white text-base line-clamp-1">{res.name}</p>
                    <p className="text-xs text-slate-400 font-medium">{res.lat}, {res.lon}</p>
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status & Active Pill Container */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none gap-4">
        <AnimatePresence>
          {activeSim && (
            <motion.div 
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              className="pointer-events-auto glass-deeper border border-blue-500/30 px-5 py-2 rounded-2xl flex items-center gap-4 shadow-xl"
            >
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
              <div className="flex flex-col">
                <p className="text-xs font-bold text-blue-400 uppercase tracking-widest leading-none mb-1">Simulation Active</p>
                <p className="text-sm font-bold text-white leading-none max-w-[250px] truncate">
                  {activeSim.name || `${activeSim.lat.toFixed(4)}, ${activeSim.lon.toFixed(4)}`}
                </p>
              </div>
              
              <div className="w-px h-6 bg-white/10 mx-1" />
              
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => toggleFavorite(activeSim)}
                  className={`p-2 rounded-lg transition-colors ${isFavorite(activeSim.lat, activeSim.lon) ? 'text-yellow-400 bg-yellow-400/10' : 'text-slate-400 hover:bg-white/10'}`}
                  title={isFavorite(activeSim.lat, activeSim.lon) ? "Retirer des favoris" : "Ajouter aux favoris"}
                >
                  <Star className={`w-5 h-5 ${isFavorite(activeSim.lat, activeSim.lon) ? 'fill-current' : ''}`} />
                </button>
                <button 
                  onClick={resetLocation}
                  className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  title="Arrêter la simulation"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: -400 }}
              animate={{ x: 0 }}
              exit={{ x: -400 }}
              className="absolute top-0 left-0 bottom-0 w-96 glass-dark z-[70] shadow-2xl p-6 flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                  Global Mock
                </h2>
                <button 
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-6 -mx-2 px-2 scrollbar-hide">
                <section>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-400 mb-3 px-2">
                    <History className="w-4 h-4" />
                    <span>RÉCENTS</span>
                  </div>
                  <div className="space-y-1">
                    {history.length > 0 ? history.map((item, i) => (
                      <button 
                        key={i}
                        onClick={() => {selectLocation(item); setSidebarOpen(false);}}
                        className="w-full p-3 rounded-xl hover:bg-white/5 transition-colors text-left group"
                      >
                        <p className="font-medium line-clamp-1">{item.name || "Position"}</p>
                        <p className="text-xs text-slate-500">{item.lat}, {item.lon}</p>
                      </button>
                    )) : (
                      <p className="p-4 text-center text-slate-600 italic text-sm">Aucun historique</p>
                    )}
                  </div>
                </section>
                
                <section>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-400 mb-3 px-2">
                    <Star className="w-4 h-4" />
                    <span>FAVORIS</span>
                  </div>
                  {favorites.length > 0 ? (
                    <div className="space-y-1">
                      {favorites.map((fav, i) => (
                        <button key={i} className="w-full p-3 rounded-xl hover:bg-white/5 transition-colors text-left">
                          <p className="font-medium">{fav.name}</p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="p-4 text-center text-slate-600 italic text-sm">Aucun favori</p>
                  )}
                </section>
              </div>

              <div className="mt-auto pt-6 border-t border-white/5 space-y-3">
                <div className="flex gap-2">
                  <button 
                    onClick={() => {setSettingsOpen(true); setSidebarOpen(false);}}
                    className="flex-1 h-12 glass hover:bg-white/10 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Settings className="w-5 h-5" />
                    <span className="text-sm">Réglages</span>
                  </button>
                  <button 
                    onClick={() => {setQrOpen(true); setSidebarOpen(false);}}
                    className="flex-1 h-12 glass hover:bg-white/10 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <QrCode className="w-5 h-5" />
                    <span className="text-sm">QR Code</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <QrModal isOpen={qrOpen} onClose={() => setQrOpen(false)} />

      {/* Action Pill (Bottom Center) */}
      <AnimatePresence>
        {selectedPos && (
          <motion.div 
            initial={{ y: 50, opacity: 0, x: '-50%' }}
            animate={{ y: 0, opacity: 1, x: '-50%' }}
            exit={{ y: 50, opacity: 0, x: '-50%' }}
            className="absolute bottom-28 left-1/2 z-50 glass-dark px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-6 border border-white/10 min-w-[320px]"
          >
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-100 truncate">{selectedPos.name || "Lieu sélectionné"}</p>
              <p className="text-xs text-slate-400 font-mono">{selectedPos.lat}, {selectedPos.lon}</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={resetLocation}
                className="p-3 glass hover:bg-white/10 rounded-2xl transition-colors text-slate-400"
                title="Réinitialiser"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
              <button 
                onClick={teleport}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
              >
                <Navigation className="w-5 h-5" />
                Allez ici
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Pill (Bottom Anchored) */}
      <div className="absolute bottom-8 right-8 z-50">
        <motion.div 
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className={`flex items-center gap-4 px-6 py-3 rounded-2xl glass-dark border-l-4 ${
            status.state === 'ready' ? 'border-l-emerald-500' : 'border-l-blue-500'
          } shadow-xl`}
        >
          <div className={`w-3 h-3 rounded-full ${status.state === 'ready' ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]' : 'bg-blue-500 animate-pulse'}`} />
          <div>
            <p className="font-bold text-sm leading-none mb-1">
              {status.message}
            </p>
            {status.type && <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Connecté via {status.type}</p>}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default App;
