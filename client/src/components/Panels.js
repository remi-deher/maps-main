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

export function ActionPanel({ visible, coords, isFavorite, onTeleport, onToggleFavorite, onClose }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { 
      toValue: visible ? 1 : 0, 
      useNativeDriver: true,
      friction: 8,
      tension: 40
    }).start();
  }, [visible]);

  if (!visible && anim._value === 0) return null;

  return (
    <Animated.View style={[styles.sheetContainer, SHADOWS.premium, { 
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [300, 0] }) }] 
    }]}>
      <View style={styles.sheetHandle} />
      
      <View style={styles.sheetContent}>
        <View style={styles.sheetHeader}>
          <View style={{flex: 1}}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{coords?.name || "Lieu sélectionné"}</Text>
            <Text style={styles.sheetCoords}>{coords?.latitude.toFixed(6)}, {coords?.longitude.toFixed(6)}</Text>
          </View>
          <ScaleButton onPress={() => onToggleFavorite(coords)} style={[styles.sheetFavBtn, isFavorite && styles.sheetFavBtnActive]}>
            <Text style={{fontSize: 24, color: isFavorite ? '#fff' : COLORS.textSecondary}}>{isFavorite ? '★' : '☆'}</Text>
          </ScaleButton>
          <TouchableOpacity onPress={onClose} style={styles.sheetClose}>
            <Text style={{color: COLORS.textMuted, fontSize: 18}}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sheetActions}>
          <ScaleButton style={styles.mainActionBtn} onPress={() => onTeleport(coords)}>
            <Text style={styles.mainActionText}>LANCER LA SIMULATION</Text>
          </ScaleButton>
        </View>
      </View>
    </Animated.View>
  );
}

export function FavoritesPanel({ visible, favorites, history, onClose, onTeleport, onRemove, onRename }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: visible ? 1 : 0, useNativeDriver: false, friction: 8 }).start();
  }, [visible]);

  const handleRename = (fav) => {
    Alert.prompt(
      "Renommer le favori",
      `Nouveau nom pour ce lieu :`,
      [
        { text: "Annuler", style: "cancel" },
        { 
          text: "Enregistrer", 
          onPress: (newName) => {
            if (newName && newName.trim()) {
              onRename(fav.lat, fav.lon, newName.trim());
            }
          }
        }
      ],
      "plain-text",
      fav.name
    );
  };

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
            <View style={styles.itemActions}>
              <TouchableOpacity onPress={() => handleRename(fav)} style={styles.editBtn}>
                <Text style={{fontSize: 16}}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onRemove(fav)} style={styles.deleteBtn}>
                <Text style={{fontSize: 16}}>🗑️</Text>
              </TouchableOpacity>
            </View>
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

  sheetContainer: { 
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 100,
    backgroundColor: 'rgba(15, 23, 42, 0.98)', 
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
    paddingBottom: 40
  },
  sheetHandle: {
    width: 40, height: 5, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 3, alignSelf: 'center', marginTop: 12, marginBottom: 8
  },
  sheetContent: { padding: 24 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 12 },
  sheetTitle: { color: COLORS.text, fontWeight: '900', fontSize: 24, flex: 1 },
  sheetCoords: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, fontOpacity: 0.8 },
  sheetFavBtn: { 
    width: 54, height: 54, borderRadius: 27, 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
  },
  sheetFavBtnActive: { backgroundColor: COLORS.warning, borderColor: COLORS.warning },
  sheetClose: { padding: 10 },
  sheetActions: { marginTop: 8 },
  mainActionBtn: { 
    backgroundColor: COLORS.primary, padding: 20, borderRadius: 22, 
    alignItems: 'center', ...SHADOWS.light 
  },
  mainActionText: { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 1.5 },

  favOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.background, zIndex: 200, padding: 20 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  panelTitle: { fontSize: 34, fontWeight: '900', color: COLORS.text },
  closeBtn: { width: 48, height: 48, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  closeText: { color: COLORS.text, fontSize: 22 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: 20, borderRadius: 24, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
  itemMain: { flex: 1 },
  itemName: { color: COLORS.text, fontWeight: '800', fontSize: 17 },
  itemCoords: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  itemActions: { flexDirection: 'row', gap: 8 },
  editBtn: { padding: 10, backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 12 },
  deleteBtn: { padding: 10, backgroundColor: 'rgba(244, 63, 94, 0.1)', borderRadius: 12 },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40, fontWeight: '600', fontSize: 16 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 15, paddingLeft: 5 },
  itemHistory: { opacity: 0.85, paddingVertical: 15 }
});
