import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Dimensions, ScrollView, SafeAreaView, Pressable } from 'react-native';
import { COLORS, SHADOWS } from '../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Helper pour les micro-interactions de pression
const ScaleButton = ({ children, onPress, style }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scale, { toValue: 0.95, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();

  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
};

export function QuickFavorites({ favorites, onTeleport, visible }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: visible ? 1 : 0, useNativeDriver: true }).start();
  }, [visible]);

  if (!visible || favorites.length === 0) return null;

  return (
    <Animated.View style={[styles.quickContainer, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickScroll}>
        {favorites.slice(0, 5).map((fav, i) => (
          <ScaleButton key={i} onPress={() => onTeleport({ latitude: fav.lat, longitude: fav.lon, name: fav.name })} style={styles.quickItem}>
            <Text style={styles.quickEmoji}>⭐</Text>
            <Text style={styles.quickText} numberOfLines={1}>{fav.name}</Text>
          </ScaleButton>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

export function ActionPanel({ visible, coords, isFavorite, onTeleport, onToggleFavorite }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: visible ? 1 : 0, useNativeDriver: true }).start();
  }, [visible]);

  if (!visible && anim._value === 0) return null;

  return (
    <Animated.View style={[styles.actionContainer, SHADOWS.premium, { 
      opacity: anim, 
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] 
    }]}>
      <View style={styles.actionContent}>
        <View style={styles.actionHeader}>
          <View style={{flex: 1}}>
            <Text style={styles.title} numberOfLines={1}>{coords?.name}</Text>
            <Text style={styles.coords}>{coords?.latitude.toFixed(4)}, {coords?.longitude.toFixed(4)}</Text>
          </View>
          <ScaleButton onPress={() => onToggleFavorite(coords)} style={styles.favBtn}>
            <Text style={{fontSize: 28}}>{isFavorite ? '★' : '☆'}</Text>
          </ScaleButton>
        </View>
        <ScaleButton style={styles.teleportBtn} onPress={() => onTeleport(coords)}>
          <Text style={styles.teleportText}>TÉLÉPORTATION ICI</Text>
        </ScaleButton>
      </View>
    </Animated.View>
  );
}

export function FavoritesPanel({ visible, favorites, history, onClose, onTeleport, onRemove }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: visible ? 1 : 0, useNativeDriver: false, friction: 8 }).start();
  }, [visible]);

  return (
    <Animated.View style={[styles.favOverlay, { 
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_HEIGHT, 0] }) }]
    }]}>
      <SafeAreaView style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Lieux</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}><Text style={styles.closeText}>✕</Text></TouchableOpacity>
      </SafeAreaView>
      
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {/* SECTION FAVORIS */}
        <Text style={styles.sectionTitle}>Favoris ⭐</Text>
        {favorites.length > 0 ? favorites.map((fav, i) => (
          <View key={`fav-${i}`} style={[styles.item, SHADOWS.light]}>
            <TouchableOpacity style={styles.itemMain} onPress={() => onTeleport({ latitude: fav.lat, longitude: fav.lon, name: fav.name })}>
              <Text style={styles.itemName}>{fav.name}</Text>
              <Text style={styles.itemCoords}>{fav.lat.toFixed(4)}, {fav.lon.toFixed(4)}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onRemove(fav)} style={styles.deleteBtn}>
              <Text style={{fontSize: 18}}>🗑️</Text>
            </TouchableOpacity>
          </View>
        )) : <Text style={styles.empty}>Aucun favori enregistré.</Text>}

        {/* SECTION RÉCENTS */}
        <Text style={[styles.sectionTitle, { marginTop: 30 }]}>Historique Récents 🕒</Text>
        {history && history.length > 0 ? history.map((item, i) => (
          <TouchableOpacity 
            key={`hist-${i}`} 
            style={[styles.item, styles.itemHistory, SHADOWS.light]} 
            onPress={() => onTeleport({ latitude: item.lat, longitude: item.lon, name: item.name })}
          >
            <View style={styles.itemMain}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemCoords}>{item.lat.toFixed(4)}, {item.lon.toFixed(4)}</Text>
            </View>
            <Text style={{fontSize: 16}}>📍</Text>
          </TouchableOpacity>
        )) : <Text style={styles.empty}>Aucun historique récent.</Text>}
        <View style={{height: 50}} />
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  quickContainer: { position: 'absolute', bottom: 185, left: 0, right: 0, zIndex: 55 },
  quickScroll: { paddingHorizontal: 20, gap: 10 },
  quickItem: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(30, 41, 59, 0.95)', 
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', ...SHADOWS.light
  },
  quickEmoji: { fontSize: 14 },
  quickText: { color: COLORS.text, fontSize: 12, fontWeight: '700', maxWidth: 120 },

  actionContainer: { position: 'absolute', bottom: 30, left: 20, right: 90, zIndex: 60 },
  actionContent: { backgroundColor: COLORS.surface, borderRadius: 28, padding: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  actionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  title: { color: COLORS.text, fontWeight: '900', fontSize: 20 },
  coords: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  favBtn: { padding: 4 },
  teleportBtn: { backgroundColor: COLORS.primary, padding: 18, borderRadius: 20, alignItems: 'center', ...SHADOWS.light },
  teleportText: { color: COLORS.text, fontWeight: '900', fontSize: 14, letterSpacing: 1 },

  favOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.background, zIndex: 100, padding: 20 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  panelTitle: { fontSize: 34, fontWeight: '900', color: COLORS.text },
  closeBtn: { width: 48, height: 48, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  closeText: { color: COLORS.text, fontSize: 22 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: 20, borderRadius: 24, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
  itemMain: { flex: 1 },
  itemName: { color: COLORS.text, fontWeight: '800', fontSize: 17 },
  itemCoords: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  deleteBtn: { padding: 10, backgroundColor: 'rgba(244, 63, 94, 0.1)', borderRadius: 12 },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40, fontWeight: '600', fontSize: 16 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 15, paddingLeft: 5 },
  itemHistory: { opacity: 0.85, paddingVertical: 15 }
});
