import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, TextInput, TouchableOpacity, Text, SafeAreaView, Animated } from 'react-native';
import { COLORS, SHADOWS } from '../constants/theme';

export default function Omnibar({ 
  searchQuery, 
  onSearchChange, 
  onSearchSubmit, 
  onScannerPress, 
  onSettingsPress,
  status,
  isMaintaining
}) {
  const pillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pillAnim, {
      toValue: status === 'Connecté' ? 1 : 0.8,
      useNativeDriver: true,
      friction: 8
    }).start();
  }, [status]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.bar, SHADOWS.premium]}>
        <TouchableOpacity style={styles.btn} onPress={onSettingsPress} activeOpacity={0.7}>
          <Text style={{fontSize: 20}}>⚙️</Text>
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
        <Text style={styles.pillText}>{status} {isMaintaining && '• 🛡️'}</Text>
      </Animated.View>
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
  pill: { 
    alignSelf: 'center', marginTop: 12, paddingHorizontal: 16, paddingVertical: 6, 
    borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 8
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff', opacity: 0.8 },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 }
});
