import React, { useState, useEffect, useRef } from 'react';
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
  
  const searchInputRef = useRef(null);
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
      }
    });

    // MOUCHARD DE FOCUS ET CLIC
    const interval = setInterval(() => {
      if (document.activeElement) {
        console.log("Focus actuel sur:", document.activeElement.tagName, document.activeElement.id || document.activeElement.className);
      }
    }, 2000);

    const clickListener = (e) => {
      console.log("Élément cliqué:", e.target.tagName, "Classes:", e.target.className);
    };
    window.addEventListener('mousedown', clickListener);

    return () => {
      removeListener();
      clearInterval(interval);
      window.removeEventListener('mousedown', clickListener);
    };
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
    console.log("Clic forçage focus sur input");
    window.focus();
    searchInputRef.current?.focus();
  };

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden text-slate-200">
      
      {/* Background Map */}
      <div className="absolute inset-0 z-0" tabIndex="-1">
        <MapView onMapClick={handleMapClick} selectedPos={selectedPos || activeSim} />
      </div>

      {/* UI Elements */}
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
                >
                  <Star className={`w-5 h-5 ${isFavorite(activeSim.lat, activeSim.lon) ? 'fill-current' : ''}`} />
                </button>
                <button onClick={resetLocation} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sidebar, Settings, etc. */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSidebarOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[60]" />
            <motion.div initial={{ x: -400 }} animate={{ x: 0 }} exit={{ x: -400 }} className="absolute top-0 left-0 bottom-0 w-96 glass-dark z-[70] shadow-2xl p-6 flex flex-col">
               {/* Content ... */}
               <button onClick={() => setSidebarOpen(false)} className="self-end p-2 mb-4"><X /></button>
               <h2 className="text-2xl font-bold mb-8">Menu</h2>
               <div className="flex-1">
                  <p className="text-slate-400">Favoris et Historique synchronisés.</p>
               </div>
               <button onClick={() => {setSettingsOpen(true); setSidebarOpen(false);}} className="w-full p-4 glass rounded-xl mb-2">Réglages</button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <QrModal isOpen={qrOpen} onClose={() => setQrOpen(false)} />

      {/* OMNIBAR - DERNIER ÉLÉMENT DU DOM ET SANS MOTION POUR TEST */}
      <div 
        className="absolute top-6 left-1/2 -translate-x-1/2 w-full max-w-2xl z-[10000] px-6"
        style={{ pointerEvents: 'auto' }}
      >
        <div 
          className="w-full bg-[#1a1a2e] border-2 border-blue-500/50 rounded-2xl h-14 flex items-center px-4 gap-4 shadow-2xl cursor-text"
          style={{ pointerEvents: 'auto', WebkitAppRegion: 'no-drag' }}
          onClick={handleContainerClick}
        >
          <Monitor className="w-6 h-6 text-blue-300" onClick={() => setSidebarOpen(true)} />
          <div className="relative flex-1 flex items-center h-full">
            <Search className="w-5 h-5 text-slate-300 absolute left-0 pointer-events-none" />
            <input 
              id="search-input"
              ref={searchInputRef}
              type="text" 
              defaultValue={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                console.log("Touche pressée:", e.key);
                if (e.key === 'Enter') search(e.target.value);
              }}
              placeholder="Cliquez ici pour taper..."
              className="w-full bg-transparent border-none outline-none text-lg pl-10 text-white font-bold placeholder:text-slate-400 focus:bg-white/5"
              style={{ 
                userSelect: 'text', 
                WebkitUserSelect: 'text',
                WebkitAppRegion: 'no-drag',
                pointerEvents: 'auto'
              }}
            />
          </div>
          <QrCode className="w-6 h-6 text-slate-300" onClick={() => setQrOpen(true)} />
        </div>
      </div>
    </div>
  );
}

export default App;
