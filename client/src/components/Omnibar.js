import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, TextInput, TouchableOpacity, Text, SafeAreaView, Animated, ScrollView } from 'react-native';
import { COLORS, SHADOWS } from '../constants/theme';

import { Ionicons } from '@expo/vector-icons';

export default function Omnibar({ 
  searchQuery, 
  onSearchChange, 
  onSearchSubmit, 
  onScannerPress, 
  onSettingsPress,
  onDebugPress,
  onSuggestionSelect,
  status,
  isMaintaining,
  isLowPowerMode,
  telemetry,
  // Nouveaux props pour le mode itinéraire
  isRouteMode,
  onToggleRouteMode,
  routePoints,
  onUpdateRoutePoint,
  onAddStep,
  onRemoveStep,
  onMoveStep,
  onStartRoute
}) {
  const pillAnim = useRef(new Animated.Value(0)).current;
  const expandAnim = useRef(new Animated.Value(0)).current;
  
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeInputIdx, setActiveInputIdx] = useState(null);
  const [isFocused, setIsFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState(['Paris', 'Lyon', 'Marseille']); // TODO: Persister

  useEffect(() => {
    Animated.spring(pillAnim, {
      toValue: status === 'Connecté' ? 1 : 0.8,
      useNativeDriver: true,
      friction: 8
    }).start();
  }, [status]);

  useEffect(() => {
    Animated.spring(expandAnim, {
      toValue: isRouteMode ? 1 : 0,
      useNativeDriver: false,
      friction: 8
    }).start();
  }, [isRouteMode]);

  // Logique de suggestions unifiée
  const triggerSearch = async (query, index) => {
    if (query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`);
      const data = await response.json();
      setSuggestions(data);
      setActiveInputIdx(index);
      setShowSuggestions(data.length > 0);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelect = (item) => {
    setShowSuggestions(false);
    const coords = {
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      name: item.display_name.split(',')[0]
    };

    if (isRouteMode && activeInputIdx !== null) {
      onUpdateRoutePoint(activeInputIdx, { ...coords, address: coords.name, lat: coords.latitude, lon: coords.longitude });
    } else {
      onSuggestionSelect(coords);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[
        styles.barWrapper, 
        SHADOWS.premium,
        { 
          height: expandAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [64, 380] // S'adapte au contenu
          }),
          borderRadius: expandAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [32, 28]
          })
        }
      ]}>
        {!isRouteMode ? (
          /* --- MODE RECHERCHE SIMPLE --- */
          <View style={styles.simpleBar}>
            <TouchableOpacity style={styles.btn} onPress={onSettingsPress}>
              <Ionicons name="settings-outline" size={20} color={COLORS.text} />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder="Où allez-vous ?"
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setTimeout(() => setIsFocused(false), 200)}
              onChangeText={(val) => {
                onSearchChange(val);
                triggerSearch(val, null);
              }}
              onSubmitEditing={onSearchSubmit}
            />
            <TouchableOpacity style={styles.routeBtn} onPress={onToggleRouteMode}>
              <Ionicons name="navigate" size={20} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={onScannerPress}>
              <Ionicons name="qr-code-outline" size={20} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        ) : (
          /* --- MODE ITINÉRAIRE (GOOGLE MAPS STYLE) --- */
          <View style={styles.routeContainer}>
            <View style={styles.routeHeader}>
              <TouchableOpacity onPress={onToggleRouteMode} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={22} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.routeTitle}>Itinéraire</Text>
              <TouchableOpacity onPress={onStartRoute} style={styles.goBtn}>
                <Text style={styles.goText}>GO</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.routeList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {routePoints.map((point, index) => (
                <View key={point.id || index} style={styles.pointRow}>
                  <View style={styles.indicatorCol}>
                    <View style={[styles.dot, { backgroundColor: index === 0 ? COLORS.primary : (index === routePoints.length - 1 ? COLORS.error : COLORS.success) }]} />
                    {index < routePoints.length - 1 && <View style={styles.dotLine} />}
                  </View>
                  
                  <View style={styles.inputCol}>
                    <TextInput
                      style={styles.routeInput}
                      value={point.address || point.name}
                      placeholder={index === 0 ? "Point de départ" : "Ajouter une étape..."}
                      placeholderTextColor={COLORS.textMuted}
                      onChangeText={(val) => {
                        onUpdateRoutePoint(index, { address: val });
                        triggerSearch(val, index);
                      }}
                    />
                    
                    {index > 0 && (
                      <View style={styles.pointOptions}>
                        <TouchableOpacity 
                          style={styles.transportBtn}
                          onPress={() => {
                            const types = ['drive', 'walk', 'flight', 'wait'];
                            const next = types[(types.indexOf(point.type || 'drive') + 1) % types.length];
                            onUpdateRoutePoint(index, { type: next });
                          }}
                        >
                          <Text style={styles.typeIcon}>
                            {point.type === 'walk' ? '🚶' : (point.type === 'flight' ? '✈️' : (point.type === 'wait' ? '⏳' : '🚗'))}
                          </Text>
                        </TouchableOpacity>
                        
                        <View style={styles.reorderBtns}>
                          <TouchableOpacity onPress={() => onMoveStep(index, -1)} disabled={index <= 1} style={{opacity: index <= 1 ? 0.2 : 1}}>
                            <Ionicons name="chevron-up" size={16} color={COLORS.textMuted} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => onMoveStep(index, 1)} disabled={index >= routePoints.length - 2} style={{opacity: index >= routePoints.length - 2 ? 0.2 : 1}}>
                            <Ionicons name="chevron-down" size={16} color={COLORS.textMuted} />
                          </TouchableOpacity>
                        </View>

                        {index > 0 && index < routePoints.length - 1 && (
                          <TouchableOpacity onPress={() => onRemoveStep(point.id)} style={styles.removeBtn}>
                            <Ionicons name="close-circle" size={18} color={COLORS.error} />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              ))}
              
              <TouchableOpacity style={styles.addStepRow} onPress={onAddStep}>
                <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
                <Text style={styles.addStepText}>Ajouter une étape</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </Animated.View>

      {/* Suggestions et Récents style Plans */}
      {(showSuggestions || (isFocused && !searchQuery)) && (
        <View style={[styles.suggestions, SHADOWS.premium, isRouteMode && styles.suggestionsRoute]}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight: 350}}>
            {/* --- FAVORIS ET RÉCENTS (Si vide) --- */}
            {!searchQuery && (
              <>
                <Text style={styles.sectionTitle}>Favoris</Text>
                {(status === 'Connecté' ? (telemetry?.favorites || []) : []).slice(0, 3).map((fav, i) => (
                  <TouchableOpacity key={`fav-${i}`} style={styles.suggestionItem} onPress={() => onSuggestionSelect({ latitude: fav.lat, longitude: fav.lon, name: fav.name })}>
                    <View style={[styles.suggestionIcon, { backgroundColor: 'rgba(52, 211, 153, 0.2)' }]}>
                      <Ionicons name="star" size={16} color="#34d399" />
                    </View>
                    <Text style={styles.suggestionTitle}>{fav.name}</Text>
                  </TouchableOpacity>
                ))}

                <Text style={styles.sectionTitle}>Recherches récentes</Text>
                {recentSearches.map((term, i) => (
                  <TouchableOpacity key={`recent-${i}`} style={styles.suggestionItem} onPress={() => { onSearchChange(term); triggerSearch(term, null); }}>
                    <View style={styles.suggestionIcon}>
                      <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
                    </View>
                    <Text style={styles.suggestionTitle}>{term}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* --- RÉSULTATS DE RECHERCHE --- */}
            {suggestions.map((item, index) => (
              <TouchableOpacity 
                key={index} 
                style={styles.suggestionItem} 
                onPress={() => handleSelect(item)}
              >
                <View style={styles.suggestionIcon}>
                  <Ionicons name="location-outline" size={16} color={COLORS.primary} />
                </View>
                <View style={{flex: 1}}>
                  <Text style={styles.suggestionTitle} numberOfLines={1}>{item.display_name.split(',')[0]}</Text>
                  <Text style={styles.suggestionSub} numberOfLines={1}>{item.display_name.split(',').slice(1).join(',').trim()}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      
      {!isRouteMode && (
        <TouchableOpacity onPress={onDebugPress} activeOpacity={0.8}>
          <Animated.View style={[
            styles.pill, 
            SHADOWS.light,
            { 
              backgroundColor: status === 'Connecté' ? COLORS.success : COLORS.error,
              transform: [{ scale: pillAnim }, { translateY: pillAnim.interpolate({ inputRange: [0.8, 1], outputRange: [-5, 0] }) }],
              opacity: pillAnim
            }
          ]}>
            <Ionicons name={status === 'Connecté' ? "checkmark-circle" : "alert-circle"} size={14} color="#fff" />
            <Text style={styles.pillText}>
              {status} {isMaintaining && '• SHIELD'} {isLowPowerMode && '• BATT'} {telemetry?.latency && `• ${telemetry.latency}ms`}
            </Text>
          </Animated.View>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 15, right: 15, zIndex: 100 },
  barWrapper: { backgroundColor: 'rgba(30, 41, 59, 0.98)', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  simpleBar: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', height: 64 },
  input: { flex: 1, fontSize: 17, color: COLORS.text, paddingHorizontal: 10, fontWeight: '500' },
  btn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, marginHorizontal: 2 },
  routeBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(99, 102, 241, 0.15)', borderRadius: 14, marginHorizontal: 4 },
  
  /* --- STYLES MODE ROUTE --- */
  routeContainer: { padding: 15, flex: 1 },
  routeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  backBtn: { padding: 5 },
  routeTitle: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' },
  goBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 15, paddingVertical: 6, borderRadius: 10 },
  goText: { color: '#fff', fontWeight: '900' },
  routeList: { flex: 1 },
  pointRow: { flexDirection: 'row', marginBottom: 15 },
  indicatorCol: { width: 30, alignItems: 'center', paddingTop: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotLine: { width: 2, flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 4 },
  inputCol: { flex: 1, gap: 8 },
  routeInput: { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 12, color: COLORS.text, fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  pointOptions: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 5 },
  transportBtn: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 6, borderRadius: 8 },
  typeIcon: { fontSize: 16 },
  reorderBtns: { flexDirection: 'row', gap: 10, backgroundColor: 'rgba(255,255,255,0.03)', padding: 4, borderRadius: 8 },
  removeBtn: { marginLeft: 'auto' },
  addStepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 30 },
  addStepText: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },

  suggestions: {
    marginTop: 8,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  suggestionsRoute: { position: 'absolute', top: 380, left: 0, right: 0 },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    gap: 12
  },
  suggestionIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(99, 102, 241, 0.2)',
    justifyContent: 'center', alignItems: 'center'
  },
  suggestionTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  suggestionSub: { color: COLORS.textMuted, fontSize: 12 },
  sectionTitle: { color: COLORS.textMuted, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', paddingHorizontal: 15, paddingTop: 15, paddingBottom: 5, letterSpacing: 1 },
  pill: { 
    alignSelf: 'center', marginTop: 12, paddingHorizontal: 16, paddingVertical: 6, 
    borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 8
  },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 }
});
