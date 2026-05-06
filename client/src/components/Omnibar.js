import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, TextInput, TouchableOpacity, Text, SafeAreaView, Animated, ScrollView } from 'react-native';
import { COLORS, SHADOWS } from '../constants/theme';

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
  telemetry
}) {
  const pillAnim = useRef(new Animated.Value(0)).current;
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    Animated.spring(pillAnim, {
      toValue: status === 'Connecté' ? 1 : 0.8,
      useNativeDriver: true,
      friction: 8
    }).start();
  }, [status]);

  // Logique de suggestions en temps réel
  useEffect(() => {
    if (searchQuery.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=5`);
        const data = await response.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      } catch (e) {
        console.error(e);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelect = (item) => {
    setShowSuggestions(false);
    onSuggestionSelect({
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      name: item.display_name.split(',')[0]
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.bar, SHADOWS.premium]}>
        <TouchableOpacity style={styles.btn} onPress={onSettingsPress} activeOpacity={0.7}>
          <Text style={{fontSize: 20}}>⚙️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={onDebugPress} activeOpacity={0.7}>
          <Text style={{fontSize: 20}}>📜</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Rechercher..."
          placeholderTextColor={COLORS.textMuted}
          value={searchQuery}
          onChangeText={onSearchChange}
          onSubmitEditing={onSearchSubmit}
        />
        <TouchableOpacity style={styles.btn} onPress={onScannerPress} activeOpacity={0.7}>
          <Text style={{fontSize: 20}}>📷</Text>
        </TouchableOpacity>
      </View>

      {/* Suggestions style Plans */}
      {showSuggestions && (
        <View style={[styles.suggestions, SHADOWS.premium]}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight: 250}}>
            {suggestions.map((item, index) => (
              <TouchableOpacity 
                key={index} 
                style={styles.suggestionItem} 
                onPress={() => handleSelect(item)}
              >
                <View style={styles.suggestionIcon}><Text style={{fontSize: 12}}>📍</Text></View>
                <View style={{flex: 1}}>
                  <Text style={styles.suggestionTitle} numberOfLines={1}>{item.display_name.split(',')[0]}</Text>
                  <Text style={styles.suggestionSub} numberOfLines={1}>{item.display_name.split(',').slice(1).join(',').trim()}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      
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
          <View style={styles.statusDot} />
          <Text style={styles.pillText}>
            {status} {isMaintaining && '• 🛡️'} {isLowPowerMode && '• 🔋'} {telemetry?.latency && `• 📶 ${telemetry.latency}ms`}
          </Text>
        </Animated.View>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 15, right: 15, zIndex: 10 },
  bar: { 
    flexDirection: 'row', backgroundColor: 'rgba(30, 41, 59, 0.98)', borderRadius: 24, 
    paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', 
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
  },
  input: { flex: 1, fontSize: 17, color: COLORS.text, paddingHorizontal: 10, fontWeight: '500' },
  btn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, marginHorizontal: 2 },
  suggestions: {
    marginTop: 8,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
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
  pill: { 
    alignSelf: 'center', marginTop: 12, paddingHorizontal: 16, paddingVertical: 6, 
    borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 8
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff', opacity: 0.8 },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 }
});
