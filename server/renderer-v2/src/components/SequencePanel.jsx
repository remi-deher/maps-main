import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { X, Plus, Trash2, Play, Clock, Navigation, Plane, MapPin, Search, Loader2, Edit3, Flag, GripVertical, ChevronLeft, Crosshair, RefreshCcw, Repeat, Save, Folder, Download, Trash } from 'lucide-react';
import gps from '../utils/gps-bridge';
import { useSearch } from '../hooks/useSearch';
import { fetchRoute } from '../utils/routing';

export default function SequencePanel({ activeSim, points, setPoints, onClose, pickingPointId, setPickingPointId, setSidebarOpen }) {
  const { search, results, loading, setResults } = useSearch();
  const [activeSearchId, setActiveSearchId] = useState(null);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [isLooping, setIsLooping] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [savedTrips, setSavedTrips] = useState([]);

  const startPicking = (id) => {
    setPickingPointId(id);
    setSidebarOpen(false);
  };

  // Initialisation et chargement des presets
  useEffect(() => {
    const loadData = async () => {
      const s = await gps.getSettings();
      if (s && s.savedTrips) setSavedTrips(s.savedTrips);
      
      if (points.length === 0) {
        const startPos = activeSim || { lat: 48.8566, lon: 2.3522, name: 'Ma position' };
        const destPos = { ...startPos, name: 'Destination' };
        
        setPoints([
          { id: 'start', lat: startPos.lat, lon: startPos.lon, address: startPos.name || 'Départ', type: 'start' },
          { id: 'dest', lat: destPos.lat, lon: destPos.lon, address: '', type: 'drive', speed: 30, duration: 60 }
        ]);
      }
    };
    loadData();
  }, []);

  const toggleLoop = () => {
    const newVal = !isLooping;
    setIsLooping(newVal);
    gps.setSequencerLoop(newVal);
  };

  const reverseRoute = () => {
    if (points.length < 2) return;
    const reversed = [...points].reverse();
    const newPoints = reversed.map((p, i) => {
      const newP = { ...p };
      if (i === 0) {
        newP.id = 'start';
        newP.type = 'start';
      } else {
        newP.id = i === reversed.length - 1 ? 'dest' : Math.random().toString(36).substr(2, 9);
        const oldP = points[points.length - i];
        newP.type = oldP.type || 'drive';
        newP.speed = oldP.speed || 30;
        newP.duration = oldP.duration || 60;
      }
      return newP;
    });
    setPoints(newPoints);
    // On rafraîchit tous les tracés après inversion
    refreshAllPaths(newPoints);
  };

  const refreshAllPaths = async (currentPoints) => {
    const updated = [...currentPoints];
    for (let i = 1; i < updated.length; i++) {
      const path = await fetchRoute(updated[i-1], updated[i], updated[i].type);
      updated[i].path = path;
    }
    setPoints(updated);
  };

  const updateLegPath = async (idx, currentPoints) => {
    if (idx <= 0 || idx >= currentPoints.length) return;
    const pStart = currentPoints[idx-1];
    const pEnd = currentPoints[idx];
    const path = await fetchRoute(pStart, pEnd, pEnd.type);
    
    setPoints(prev => prev.map((p, i) => i === idx ? { ...p, path } : p));
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const getCumulativeTime = (idx) => {
    let total = 0;
    for (let i = 1; i <= idx; i++) {
      total += points[i].duration || 0;
    }
    return total;
  };
    const R = 6371;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lon - p1.lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const addStep = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const lastButOneIndex = points.length - 2;
    const basePoint = points[lastButOneIndex >= 0 ? lastButOneIndex : 0];
    
    const newStep = {
      id: newId,
      lat: basePoint.lat,
      lon: basePoint.lon,
      address: '',
      type: 'walk',
      speed: 5,
      duration: 60
    };

    const newPoints = [...points];
    newPoints.splice(points.length - 1, 0, newStep);
    setPoints(newPoints);
    setExpandedId(newId);
  };

  const removeStep = (id) => {
    if (id === 'start' || id === 'dest') return;
    setPoints(points.filter(p => p.id !== id));
  };

  const updatePoint = (id, data) => {
    const idx = points.findIndex(p => p.id === id);
    if (idx <= 0 || (data.speed === undefined && data.duration === undefined)) {
      setPoints(points.map(p => p.id === id ? { ...p, ...data } : p));
      return;
    }

    const prev = points[idx - 1];
    const curr = { ...points[idx], ...data };
    const dist = calculateDistance(prev, curr);

    if (data.speed !== undefined && data.speed > 0) {
      curr.duration = Math.round((dist / data.speed) * 3600);
    } else if (data.duration !== undefined && data.duration > 0) {
      curr.speed = parseFloat((dist / (data.duration / 3600)).toFixed(1));
    }

    const newPoints = points.map(p => p.id === id ? curr : p);
    setPoints(newPoints);

    // Mettre à jour les tracés OSRM pour les segments touchés
    updateLegPath(idx, newPoints);
    if (idx + 1 < newPoints.length) {
      updateLegPath(idx + 1, newPoints);
    }
  };

  const handleSearch = (id, val) => {
    setQuery(val);
    setActiveSearchId(id);
    if (val.length > 3) {
      search(val);
    } else {
      setResults([]);
    }
  };

  const selectResult = (id, res) => {
    updatePoint(id, { 
      lat: res.lat, 
      lon: res.lon, 
      address: res.name.split(',')[0]
    });
    setResults([]);
    setQuery('');
    setActiveSearchId(null);
  };

  const startSequence = async () => {
    if (points.length < 2) return;
    const legs = [];
    for (let i = 1; i < points.length; i++) {
      const pStart = points[i-1];
      const pEnd = points[i];
      legs.push({
        type: pEnd.type || 'drive',
        start: { lat: pStart.lat, lon: pStart.lon },
        end: { lat: pEnd.lat, lon: pEnd.lon },
        startTime: Date.now(),
        endTime: Date.now() + (pEnd.duration || 60) * 1000,
        speed: pEnd.speed || 30
      });
    }
    const res = await gps.playSequence(legs);
    if (!res.success) alert("Erreur : " + res.error);
  };

  const saveTrip = async () => {
    if (!presetName.trim()) return;
    const newTrip = { name: presetName.trim(), points, id: Date.now() };
    const updatedTrips = [newTrip, ...savedTrips];
    setSavedTrips(updatedTrips);
    
    const s = await gps.getSettings();
    await gps.saveSettings({ ...s, savedTrips: updatedTrips });
    setPresetName('');
  };

  const loadTrip = (trip) => {
    setPoints(trip.points);
    setShowPresets(false);
  };

  const deleteTrip = async (id) => {
    if (!confirm(`Supprimer le trajet "${savedTrips.find(t => t.id === id)?.name}" ?`)) return;
    const updatedTrips = savedTrips.filter(t => t.id !== id);
    setSavedTrips(updatedTrips);
    const s = await gps.getSettings();
    await gps.saveSettings({ ...s, savedTrips: updatedTrips });
  };

  const handleReorder = (newIntermediatePoints) => {
    const start = points[0];
    const dest = points[points.length - 1];
    const newPoints = [start, ...newIntermediatePoints, dest];
    setPoints(newPoints);
    refreshAllPaths(newPoints);
  };

  const intermediatePoints = points.slice(1, -1);

  return (
    <div className="flex flex-col h-full bg-slate-950/40">
      <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-900/40">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-slate-400 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="h-8 w-px bg-white/5 mx-1" />
          <button 
            onClick={reverseRoute} 
            title="Inverser le trajet"
            className="p-2.5 hover:bg-indigo-500/20 rounded-xl text-indigo-400 transition-all active:rotate-180"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
          <button 
            onClick={toggleLoop} 
            title={isLooping ? "Mode boucle actif" : "Activer la boucle"}
            className={`p-2.5 rounded-xl transition-all ${isLooping ? 'bg-amber-500 text-white shadow-lg shadow-amber-900/20' : 'hover:bg-white/10 text-slate-400'}`}
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-xs font-bold text-white">{formatDuration(points.reduce((acc, p) => acc + (p.duration || 0), 0))}</span>
            <span className="text-[10px] text-slate-500 uppercase font-black tracking-tighter">Total</span>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-sm font-black text-white uppercase tracking-tight">Itinéraire</h2>
          <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest">Séquenceur Voyage</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-0 custom-scrollbar">
        {/* PRESETS SECTION */}
        <div className="mb-6 bg-white/5 border border-white/5 rounded-2xl overflow-hidden">
          <button 
            onClick={() => setShowPresets(!showPresets)}
            className="w-full p-3 flex items-center justify-between text-xs font-bold text-slate-400 hover:bg-white/5 transition-colors uppercase tracking-widest"
          >
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-indigo-400" />
              Mes Trajets Enregistrés
            </div>
            <span className="px-2 py-0.5 rounded-full bg-white/5 text-[10px]">{savedTrips.length}</span>
          </button>
          
          <AnimatePresence>
            {showPresets && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                <div className="p-3 pt-0 space-y-2 border-t border-white/5">
                  <div className="flex gap-2 mt-3">
                    <input 
                      type="text" 
                      placeholder="Nom du trajet..."
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      className="flex-1 bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs text-white outline-none focus:ring-1 focus:ring-indigo-500/50"
                    />
                    <button 
                      onClick={saveTrip}
                      disabled={!presetName.trim()}
                      className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 rounded-xl text-white transition-all active:scale-90"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                    {savedTrips.map(trip => (
                      <div key={trip.id} className="group flex items-center gap-1 p-1 bg-white/5 rounded-xl hover:bg-white/10 transition-all border border-transparent hover:border-white/5">
                        <button 
                          onClick={() => loadTrip(trip)}
                          className="flex-1 text-left px-2 py-1.5"
                        >
                          <p className="text-[11px] font-bold text-slate-200 line-clamp-1">{trip.name}</p>
                          <p className="text-[9px] text-slate-500">{trip.points.length} points</p>
                        </button>
                        <button 
                          onClick={() => deleteTrip(trip.id)}
                          className="p-2 text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {savedTrips.length === 0 && (
                      <p className="text-center py-4 text-[10px] text-slate-600 italic">Aucun trajet sauvegardé</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* DÉPART */}
        <PointItem 
          point={points[0]} 
          label="Point de départ" 
          color="indigo" 
          isSearchActive={activeSearchId === points[0]?.id}
          query={query}
          onSearch={(val) => handleSearch(points[0].id, val)}
          results={results}
          onSelect={(res) => selectResult(points[0].id, res)}
          loading={loading && activeSearchId === points[0].id}
          isPicking={pickingPointId === points[0]?.id}
          onStartPicking={() => startPicking(points[0].id)}
        />

        {/* ÉTAPES INTERMÉDIAIRES */}
        <Reorder.Group axis="y" values={intermediatePoints} onReorder={handleReorder}>
          {intermediatePoints.map((p, idx) => (
            <Reorder.Item key={p.id} value={p}>
              <PointItem 
                point={p} 
                label={`Étape ${idx + 1}`} 
                color="emerald" 
                isSearchActive={activeSearchId === p.id}
                query={query}
                onSearch={(val) => handleSearch(p.id, val)}
                results={results}
                onSelect={(res) => selectResult(p.id, res)}
                loading={loading && activeSearchId === p.id}
                onRemove={() => removeStep(p.id)}
                expanded={expandedId === p.id}
                onToggleExpand={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onUpdate={(data) => updatePoint(p.id, data)}
                isDraggable
                isPicking={pickingPointId === p.id}
                onStartPicking={() => startPicking(p.id)}
                cumulativeTime={getCumulativeTime(idx + 1)}
                formatDuration={formatDuration}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>

        {/* DESTINATION */}
        {points.length > 1 && (
          <PointItem 
            point={points[points.length - 1]} 
            label="Destination" 
            color="rose" 
            isSearchActive={activeSearchId === points[points.length - 1].id}
            query={query}
            onSearch={(val) => handleSearch(points[points.length - 1].id, val)}
            results={results}
            onSelect={(res) => selectResult(points[points.length - 1].id, res)}
            loading={loading && activeSearchId === points[points.length - 1].id}
            expanded={expandedId === points[points.length - 1].id}
            onToggleExpand={() => setExpandedId(expandedId === points[points.length - 1].id ? null : points[points.length - 1].id)}
            onUpdate={(data) => updatePoint(points[points.length - 1].id, data)}
            isLast
            isPicking={pickingPointId === points[points.length - 1].id}
            onStartPicking={() => startPicking(points[points.length - 1].id)}
            cumulativeTime={getCumulativeTime(points.length - 1)}
            formatDuration={formatDuration}
          />
        )}

        <button 
          onClick={addStep}
          className="w-full mt-4 py-4 border-2 border-dashed border-white/5 hover:border-indigo-500/30 hover:bg-indigo-500/5 rounded-2xl transition-all flex items-center justify-center gap-3 group"
        >
          <Plus className="w-4 h-4 text-slate-500 group-hover:text-indigo-400" />
          <span className="text-xs font-black text-slate-500 group-hover:text-indigo-400 uppercase">Ajouter une étape</span>
        </button>
      </div>

      <div className="p-4 bg-slate-900/60 border-t border-white/5">
        <button 
          onClick={startSequence}
          disabled={points.length < 2}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white rounded-2xl font-black uppercase text-xs tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
        >
          <Play className="w-4 h-4" fill="currentColor" /> Lancer le trajet
        </button>
      </div>
    </div>
  );
}

function PointItem({ point, label, color, isSearchActive, query, onSearch, results, onSelect, loading, onRemove, expanded, onToggleExpand, onUpdate, isLast, isDraggable, isPicking, onStartPicking, cumulativeTime, formatDuration }) {
  if (!point) return null;
  
  return (
    <div className={`relative pl-8 ${isLast ? '' : 'pb-0'}`}>
      {!isLast && <div className="absolute left-[15px] top-4 bottom-0 w-0.5 bg-white/5 border-l border-dashed border-white/10" />}
      <div className={`absolute left-2.5 top-3 w-3 h-3 rounded-full border-2 bg-slate-950 z-10 ${
        color === 'indigo' ? 'border-indigo-500' : (color === 'rose' ? 'border-rose-500' : 'border-emerald-500')
      }`} />
      
      <div className={`group mb-3 bg-white/5 border border-white/5 rounded-xl overflow-hidden transition-all ${expanded ? `ring-1 ring-${color}-500/50` : 'hover:bg-white/10'} ${isPicking ? 'ring-2 ring-indigo-500 bg-indigo-500/10' : ''}`}>
        <div className="p-3 flex items-center gap-3 cursor-pointer" onClick={onToggleExpand}>
          {isDraggable && <GripVertical className="w-3.5 h-3.5 text-slate-700 cursor-grab active:cursor-grabbing" />}
          
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center mb-0.5">
              <p className={`text-[8px] font-black uppercase tracking-tighter ${
                color === 'indigo' ? 'text-indigo-400' : (color === 'rose' ? 'text-rose-400' : 'text-emerald-400')
              }`}>{label}</p>
              {cumulativeTime !== undefined && (
                <p className="text-[8px] text-slate-500 font-bold">⏱️ T+{formatDuration(cumulativeTime)}</p>
              )}
            </div>
            <input 
              type="text"
              value={isSearchActive ? query : point.address}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={isPicking ? "Cliquez sur la carte..." : label + "..."}
              className="w-full bg-transparent border-none outline-none text-white font-bold text-xs truncate"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="flex items-center gap-1">
            <button 
              onClick={(e) => { e.stopPropagation(); onStartPicking(); }}
              className={`p-1.5 rounded-lg transition-all ${isPicking ? 'bg-indigo-500 text-white animate-pulse' : 'hover:bg-white/10 text-slate-500'}`}
              title="Choisir sur la carte"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
            {point.type !== 'start' && (
               <div className="px-1.5 py-0.5 rounded-md bg-white/5 text-[10px]">
                  {point.type === 'walk' ? '🚶' : (point.type === 'drive' ? '🚗' : (point.type === 'flight' ? '✈️' : '⏳'))}
               </div>
            )}
            {onRemove && (
               <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-1.5 hover:bg-rose-500/20 rounded-lg text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
               </button>
            )}
          </div>
        </div>

        {/* Détails */}
        <AnimatePresence>
          {expanded && point.type !== 'start' && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-3 pb-3 border-t border-white/5 pt-3 space-y-3">
               <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-600 uppercase">Transport</label>
                    <select 
                      value={point.type}
                      onChange={(e) => onUpdate({ type: e.target.value })}
                      className="w-full bg-black/40 border border-white/5 rounded-lg p-1.5 text-[10px] text-white outline-none font-bold"
                    >
                      <option value="walk" className="bg-slate-900">🚶 Marcher</option>
                      <option value="drive" className="bg-slate-900">🚗 Conduire</option>
                      <option value="flight" className="bg-slate-900">✈️ Voler</option>
                      <option value="wait" className="bg-slate-900">⏳ Attendre</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-600 uppercase">Vitesse (km/h)</label>
                    <input 
                      type="number" value={point.speed}
                      onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) })}
                      className="w-full bg-black/40 border border-white/5 rounded-lg p-1.5 text-[10px] text-white outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-600 uppercase">Durée ({formatDuration(point.duration)})</label>
                    <input 
                      type="number" value={point.duration}
                      onChange={(e) => onUpdate({ duration: parseFloat(e.target.value) })}
                      className="w-full bg-black/40 border border-white/5 rounded-lg p-1.5 text-[10px] text-white outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-600 uppercase">Coords</label>
                    <div className="text-[9px] text-slate-600 font-mono p-1.5 truncate bg-black/20 rounded-lg border border-white/5">
                       {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
                    </div>
                  </div>
               </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Résultats recherche */}
        <AnimatePresence>
            {isSearchActive && results.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute top-14 left-0 right-0 mt-1 bg-slate-900 border border-white/10 rounded-xl overflow-hidden z-[60] shadow-2xl">
                {results.map((res, i) => (
                  <button key={i} onClick={() => onSelect(res)} className="w-full p-3 text-left hover:bg-white/5 border-b border-white/5 last:border-none flex items-center gap-3">
                    <MapPin className="w-3 h-3 text-indigo-400" />
                    <span className="text-[10px] text-white truncate font-medium">{res.name}</span>
                  </button>
                ))}
              </motion.div>
            )}
        </AnimatePresence>
      </div>
    </div>
  );
}
