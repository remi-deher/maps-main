'use strict'

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import { COLORS, SHADOWS } from '../constants/theme';
import { fetchRoute, snapToRoad, optimizeRoute } from '../utils/routing';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function SequenceModal({ visible, onClose, onStart, currentCoords, points, onSync }) {
  const [activePoints, setActivePoints] = useState(points || []);
  const [loading, setLoading] = useState(false);
  const [pickingId, setPickingId] = useState(null);

  // Initialisation si vide
  useEffect(() => {
    if (visible && activePoints.length === 0) {
      const start = currentCoords ? { lat: currentCoords.latitude, lon: currentCoords.longitude } : { lat: 48.8566, lon: 2.3522 };
      setActivePoints([
        { id: 'start', lat: start.lat, lon: start.lon, address: 'Ma position', type: 'start' },
        { id: 'dest', lat: start.lat + 0.01, lon: start.lon + 0.01, address: 'Destination', type: 'drive', speed: 30, duration: 300 }
      ]);
    }
  }, [visible]);

  // Sync avec le store parent
  useEffect(() => {
    onSync(activePoints);
  }, [activePoints]);

  const addStop = () => {
    const last = activePoints[activePoints.length - 1];
    const newStop = {
      id: Math.random().toString(36).substr(2, 9),
      lat: last.lat + 0.005,
      lon: last.lon + 0.005,
      address: 'Nouvel arrêt',
      type: 'drive',
      speed: 30,
      duration: 300
    };
    const updated = [...activePoints];
    updated.splice(activePoints.length - 1, 0, newStop);
    setActivePoints(updated);
  };

  const removeStop = (id) => {
    if (id === 'start' || id === 'dest') return;
    setActivePoints(activePoints.filter(p => p.id !== id));
  };

  const updateLegPath = async (idx, currentPoints) => {
    if (idx <= 0 || idx >= currentPoints.length) return;
    const pStart = currentPoints[idx-1];
    const pEnd = currentPoints[idx];
    
    if (pEnd.type === 'flight' || pEnd.type === 'wait') {
      updatePoint(pEnd.id, { path: null });
      return;
    }

    const result = await fetchRoute(pStart, pEnd, pEnd.type);
    if (result) {
      updatePoint(pEnd.id, { 
        path: result.path,
        duration: Math.round(result.duration),
        speed: parseFloat(((result.distance / 1000) / (result.duration / 3600)).toFixed(1))
      });
    }
  };

  const updatePoint = async (id, data) => {
    const idx = activePoints.findIndex(p => p.id === id);
    const oldPoint = activePoints[idx];
    
    // Snap to road logic if position changed
    if ((data.lat !== undefined || data.lon !== undefined) && data.type !== 'flight') {
      const snapped = await snapToRoad(data.lat || oldPoint.lat, data.lon || oldPoint.lon, data.type || oldPoint.type);
      if (snapped) {
        data.lat = snapped.lat;
        data.lon = snapped.lon;
        if (!data.address && snapped.name) data.address = snapped.name;
      }
    }

    const newPoint = { ...oldPoint, ...data };
    const newPoints = activePoints.map(p => p.id === id ? newPoint : p);
    setActivePoints(newPoints);

    // Update paths for affected segments
    if (data.lat !== undefined || data.lon !== undefined || data.type !== undefined) {
      updateLegPath(idx, newPoints);
      if (idx + 1 < newPoints.length) updateLegPath(idx + 1, newPoints);
    }
  };

  const moveUp = (index) => {
    if (index <= 1) return; // Ne pas déplacer le départ
    const updated = [...activePoints];
    [updated[index], updated[index-1]] = [updated[index-1], updated[index]];
    setActivePoints(updated);
  };

  const moveDown = (index) => {
    if (index >= activePoints.length - 2) return; // Ne pas déplacer la destination au delà du dernier
    const updated = [...activePoints];
    [updated[index], updated[index+1]] = [updated[index+1], updated[index]];
    setActivePoints(updated);
  };

  const handleOptimize = async () => {
    const optimized = await optimizeRoute(activePoints, activePoints[1]?.type || 'drive');
    if (optimized) {
      setActivePoints(optimized);
      // Recalculer les chemins pour tout le monde
      // Note: On le fait séquentiellement pour OSRM
      for (let i = 1; i < optimized.length; i++) {
        await updateLegPath(i, optimized);
      }
    }
  };

  const handleStart = () => {
    const legs = [];
    let currentTime = Date.now();
    
    for (let i = 1; i < activePoints.length; i++) {
      const pStart = activePoints[i-1];
      const pEnd = activePoints[i];
      const duration = (pEnd.duration || 60) * 1000;
      
      legs.push({
        type: pEnd.type || 'drive',
        start: { lat: pStart.lat, lon: pStart.lon },
        end: { lat: pEnd.lat, lon: pEnd.lon },
        startTime: currentTime,
        endTime: currentTime + duration,
        speed: pEnd.speed || 30
      });
      currentTime += duration;
    }
    onStart(legs);
    onClose();
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

  const totalDuration = activePoints.reduce((acc, p) => acc + (p.duration || 0), 0);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
            <View style={{alignItems: 'center'}}>
              <Text style={styles.title}>Itinéraire</Text>
              <TouchableOpacity onPress={handleOptimize}>
                <Text style={styles.optimizeBtnText}>✨ Optimiser l'ordre</Text>
              </TouchableOpacity>
              <Text style={styles.totalTime}>Temps total : {formatDuration(totalDuration)}</Text>
            </View>
            <TouchableOpacity onPress={handleStart} style={styles.playBtn}>
              <Text style={styles.playText}>LANCER</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
            {activePoints.map((point, index) => (
              <View key={point.id} style={styles.pointRow}>
                <View style={styles.pointLine}>
                   <View style={[styles.dot, { backgroundColor: index === 0 ? COLORS.primary : (index === activePoints.length - 1 ? COLORS.error : COLORS.success) }]} />
                   {index < activePoints.length - 1 && (
                     <View style={styles.lineWrapper}>
                        <View style={styles.verticalLine} />
                        <View style={styles.legTimeBadge}>
                           <Text style={styles.legTimeText}>{formatDuration(activePoints[index+1]?.duration)}</Text>
                        </View>
                     </View>
                   )}
                </View>

                <View style={styles.pointContent}>
                  <View style={styles.pointHeader}>
                    <TextInput 
                      style={styles.addressInput}
                      value={point.address}
                      onChangeText={(val) => updatePoint(point.id, { address: val })}
                      placeholder="Adresse..."
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <View style={styles.pointActions}>
                      {index > 0 && index < activePoints.length - 1 && (
                        <TouchableOpacity onPress={() => removeStop(point.id)} style={styles.actionBtn}>
                          <Text style={{color: COLORS.error, fontSize: 10, fontWeight: 'bold'}}>SUPPR.</Text>
                        </TouchableOpacity>
                      )}
                      <View style={styles.reorder}>
                        <TouchableOpacity onPress={() => moveUp(index)} disabled={index <= 1} style={{ opacity: index <= 1 ? 0.3 : 1 }}>
                          <Text style={styles.reorderText}>▲</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => moveDown(index)} disabled={index >= activePoints.length - 2} style={{ opacity: index >= activePoints.length - 2 ? 0.3 : 1 }}>
                          <Text style={styles.reorderText}>▼</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  {point.type !== 'start' && (
                    <View style={styles.details}>
                      <TouchableOpacity 
                        style={styles.typeBadge} 
                        onPress={() => {
                          const types = ['drive', 'walk', 'flight', 'wait'];
                          const next = types[(types.indexOf(point.type) + 1) % types.length];
                          updatePoint(point.id, { type: next });
                        }}
                      >
                        <Text style={styles.typeText}>{point.type === 'drive' ? '🚗' : (point.type === 'walk' ? '🚶' : (point.type === 'flight' ? '✈️' : '⏳'))} {point.type.toUpperCase()}</Text>
                      </TouchableOpacity>
                      <TextInput 
                        style={styles.detailInput}
                        value={String(point.speed)}
                        keyboardType="numeric"
                        onChangeText={(val) => updatePoint(point.id, { speed: parseFloat(val) || 0 })}
                      />
                      <Text style={styles.unitText}>km/h</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}

            <TouchableOpacity style={styles.addStopBtn} onPress={addStop}>
              <Text style={styles.addStopText}>+ Ajouter un arrêt</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  container: { backgroundColor: COLORS.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, height: SCREEN_HEIGHT * 0.75, width: SCREEN_WIDTH },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '900', textTransform: 'uppercase' },
  totalTime: { color: COLORS.primary, fontSize: 10, fontWeight: 'bold', marginTop: 2 },
  optimizeBtnText: { color: COLORS.success, fontSize: 10, fontWeight: 'bold', marginTop: 2, textDecorationLine: 'underline' },
  closeBtn: { padding: 10 },
  closeText: { color: COLORS.textSecondary, fontSize: 18 },
  playBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 12 },
  playText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  list: { flex: 1, padding: 20 },
  pointRow: { flexDirection: 'row', marginBottom: 5 },
  pointLine: { width: 40, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 15 },
  lineWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  verticalLine: { width: 2, height: 60, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 5 },
  legTimeBadge: { position: 'absolute', backgroundColor: 'rgba(15, 23, 42, 0.8)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  legTimeText: { color: COLORS.textSecondary, fontSize: 8, fontWeight: 'bold' },

  pointContent: { flex: 1, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 15, padding: 12, borderSize: 1, borderColor: 'rgba(255,255,255,0.05)' },
  pointHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addressInput: { color: COLORS.text, fontSize: 14, fontWeight: 'bold', flex: 1, padding: 0 },
  pointActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionBtn: { padding: 5 },
  reorder: { flexDirection: 'column', gap: 2, alignItems: 'center' },
  reorderText: { color: COLORS.textMuted, fontSize: 12 },

  details: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 },
  typeBadge: { backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  typeText: { color: COLORS.textSecondary, fontSize: 10, fontWeight: 'bold' },
  detailInput: { backgroundColor: 'rgba(0,0,0,0.2)', color: COLORS.text, fontSize: 12, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, width: 40, textAlign: 'center' },
  unitText: { color: COLORS.textMuted, fontSize: 10 },

  addStopBtn: { borderDashStyle: 'dashed', borderDashArray: [5, 5], borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 15, borderRadius: 15, alignItems: 'center', marginTop: 10 },
  addStopText: { color: COLORS.textMuted, fontSize: 14, fontWeight: 'bold' }
});
