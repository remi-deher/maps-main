'use strict'

import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { COLORS } from '../constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function SequenceModal({ visible, onClose, onStart, currentCoords }) {
  const [legs, setLegs] = useState([]);

  const addLeg = (type) => {
    const lastLeg = legs[legs.length - 1];
    const start = lastLeg ? lastLeg.end : (currentCoords ? { lat: currentCoords.latitude, lon: currentCoords.longitude } : { lat: 48.8566, lon: 2.3522 });
    
    // Décalage bidon pour l'exemple
    const end = { lat: start.lat + 0.01, lon: start.lon + 0.01 };
    
    const newLeg = {
      id: Date.now(),
      type,
      start,
      end,
      startTime: lastLeg ? lastLeg.endTime : Date.now(),
      endTime: (lastLeg ? lastLeg.endTime : Date.now()) + (type === 'wait' ? 300000 : 600000) // 5 or 10 min
    };
    
    setLegs([...legs, newLeg]);
  };

  const removeLeg = (id) => {
    setLegs(legs.filter(l => l.id !== id));
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>Séquenceur Multimodal</Text>
          
          <ScrollView style={styles.legsList}>
            {legs.length === 0 && (
              <Text style={styles.emptyText}>Aucune étape. Ajoutez-en une pour commencer votre voyage.</Text>
            )}
            {legs.map((leg, index) => (
              <View key={leg.id} style={styles.legItem}>
                <View style={styles.legHeader}>
                  <Text style={styles.legBadge}>{leg.type.toUpperCase()}</Text>
                  <TouchableOpacity onPress={() => removeLeg(leg.id)}>
                    <Text style={styles.removeText}>SUPPRIMER</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.legCoords}>De: {leg.start.lat.toFixed(4)}, {leg.start.lon.toFixed(4)}</Text>
                <Text style={styles.legCoords}>À: {leg.end.lat.toFixed(4)}, {leg.end.lon.toFixed(4)}</Text>
                <Text style={styles.legTime}>Durée: {Math.round((leg.endTime - leg.startTime) / 60000)} min</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.addActions}>
            <TouchableOpacity style={styles.addBtn} onPress={() => addLeg('walk')}><Text style={styles.addBtnText}>🚶 MARCHE</Text></TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => addLeg('drive')}><Text style={styles.addBtnText}>🚗 VOITURE</Text></TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => addLeg('flight')}><Text style={styles.addBtnText}>✈️ VOL</Text></TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => addLeg('wait')}><Text style={styles.addBtnText}>⏳ ATTENTE</Text></TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}><Text style={styles.cancelText}>ANNULER</Text></TouchableOpacity>
            <TouchableOpacity 
              style={[styles.startBtn, legs.length === 0 && { opacity: 0.5 }]} 
              onPress={() => { if(legs.length > 0) { onStart(legs); onClose(); } }}
              disabled={legs.length === 0}
            >
              <Text style={styles.startText}>DÉMARRER LE VOYAGE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' },
  content: { backgroundColor: COLORS.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 25, height: SCREEN_HEIGHT * 0.8 },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text, marginBottom: 20, textAlign: 'center' },
  
  legsList: { flex: 1, marginBottom: 20 },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14, fontStyle: 'italic' },
  legItem: { backgroundColor: COLORS.background, borderRadius: 20, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  legHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  legBadge: { backgroundColor: COLORS.primary, color: '#fff', fontSize: 10, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  removeText: { color: COLORS.error, fontSize: 10, fontWeight: '800' },
  legCoords: { color: COLORS.textSecondary, fontSize: 12 },
  legTime: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },

  addActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  addBtn: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 12, flex: 1, minWidth: '45%', alignItems: 'center' },
  addBtnText: { color: COLORS.text, fontSize: 11, fontWeight: '800' },

  footer: { flexDirection: 'row', gap: 15 },
  cancelBtn: { flex: 1, padding: 18, alignItems: 'center' },
  startBtn: { flex: 2, backgroundColor: COLORS.success, padding: 18, borderRadius: 18, alignItems: 'center' },
  cancelText: { color: COLORS.textSecondary, fontWeight: '700' },
  startText: { color: '#000', fontWeight: '900' }
});
