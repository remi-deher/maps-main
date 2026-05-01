import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { X, Plus, Trash2, Play, Clock, Navigation, Plane, MapPin, Search, Loader2, Edit3, Flag, GripVertical, ChevronLeft, Crosshair } from 'lucide-react';
import gps from '../utils/gps-bridge';
import { useSearch } from '../hooks/useSearch';

export default function SequencePanel({ activeSim, points, setPoints, onClose, pickingPointId, setPickingPointId, setSidebarOpen }) {
  const { search, results, loading, setResults } = useSearch();
  const [activeSearchId, setActiveSearchId] = useState(null);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const startPicking = (id) => {
    setPickingPointId(id);
    setSidebarOpen(false);
  };

  // Initialisation seulement si vide
  useEffect(() => {
    if (points.length === 0) {
      const startPos = activeSim || { lat: 48.8566, lon: 2.3522, name: 'Ma position' };
      const destPos = { ...startPos, name: 'Destination' };
      
      setPoints([
        { id: 'start', lat: startPos.lat, lon: startPos.lon, address: startPos.name || 'Départ', type: 'start' },
        { id: 'dest', lat: destPos.lat, lon: destPos.lon, address: '', type: 'drive', speed: 30, duration: 60 }
      ]);
    }
  }, []);

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
    setPoints(points.map(p => p.id === id ? { ...p, ...data } : p));
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

  const handleReorder = (newIntermediatePoints) => {
    const start = points[0];
    const dest = points[points.length - 1];
    setPoints([start, ...newIntermediatePoints, dest]);
  };

  const intermediatePoints = points.slice(1, -1);

  return (
    <div className="flex flex-col h-full bg-slate-950/40">
      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-slate-400 flex items-center gap-2 text-xs font-bold uppercase">
          <ChevronLeft className="w-4 h-4" /> Retour
        </button>
        <div className="text-right">
          <h2 className="text-sm font-black text-white uppercase tracking-tight">Itinéraire</h2>
          <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest">Séquenceur Voyage</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-0 custom-scrollbar">
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

function PointItem({ point, label, color, isSearchActive, query, onSearch, results, onSelect, loading, onRemove, expanded, onToggleExpand, onUpdate, isLast, isDraggable, isPicking, onStartPicking }) {
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
            <p className={`text-[8px] font-black uppercase tracking-tighter mb-0.5 ${
              color === 'indigo' ? 'text-indigo-400' : (color === 'rose' ? 'text-rose-400' : 'text-emerald-400')
            }`}>{label}</p>
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
                    <label className="text-[8px] font-black text-slate-600 uppercase">Durée (sec)</label>
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
