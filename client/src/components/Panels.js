import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Dimensions, ScrollView, SafeAreaView, Pressable, Alert } from 'react-native';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
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

  if (!visible || !favorites || favorites.length === 0) return null;

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
  const sheet = useRef(null);

  useEffect(() => {
    if (visible) {
      sheet.current?.present();
    } else {
      sheet.current?.dismiss();
    }
  }, [visible]);

  return (
    <TrueSheet
      ref={sheet}
      sizes={['auto']}
      cornerRadius={32}
      blurTint="dark"
      onDismiss={onClose}
    >
      <View style={styles.sheetContent}>
        <View style={styles.sheetHeader}>
          <View style={{flex: 1}}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{coords?.name || "Lieu sélectionné"}</Text>
            <Text style={styles.sheetCoords}>{coords?.latitude.toFixed(6)}, {coords?.longitude.toFixed(6)}</Text>
          </View>
          <ScaleButton onPress={() => onToggleFavorite(coords)} style={[styles.sheetFavBtn, isFavorite && styles.sheetFavBtnActive]}>
            <Text style={{fontSize: 24, color: isFavorite ? '#fff' : COLORS.textSecondary}}>{isFavorite ? '★' : '☆'}</Text>
          </ScaleButton>
        </View>

        <View style={styles.sheetActions}>
          <ScaleButton style={styles.mainActionBtn} onPress={() => onTeleport(coords)}>
            <Text style={styles.mainActionText}>LANCER LA SIMULATION</Text>
          </ScaleButton>
        </View>
      </View>
    </TrueSheet>
  );
}

export function FavoritesPanel({ visible, favorites, history, onClose, onTeleport, onRemove, onRename }) {
  const sheet = useRef(null);

  useEffect(() => {
    if (visible) {
      sheet.current?.present();
    } else {
      sheet.current?.dismiss();
    }
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
    <TrueSheet
      ref={sheet}
      sizes={['50%', '90%']}
      cornerRadius={32}
      blurTint="dark"
      onDismiss={onClose}
    >
      <SafeAreaView style={styles.panelSafe}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>Mes Lieux</Text>
          <TouchableOpacity onPress={() => sheet.current?.dismiss()} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
        
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {/* SECTION FAVORIS */}
          <Text style={styles.sectionTitle}>Favoris ⭐</Text>
          {favorites && favorites.length > 0 ? favorites.map((fav, i) => (
            <View key={`fav-${i}`} style={styles.item}>
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
              style={[styles.item, styles.itemHistory]} 
              onPress={() => onTeleport({ latitude: item.lat, longitude: item.lon, name: item.name })}
            >
              <View style={styles.itemMain}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemCoords}>{item.lat.toFixed(4)}, {item.lon.toFixed(4)}</Text>
              </View>
              <Text style={{fontSize: 16}}>📍</Text>
            </TouchableOpacity>
          )) : <Text style={styles.empty}>Aucun historique récent.</Text>}
          <View style={{height: 100}} />
        </ScrollView>
      </SafeAreaView>
    </TrueSheet>
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

  sheetContent: { padding: 24, paddingBottom: 40 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 12 },
  sheetTitle: { color: COLORS.text, fontWeight: '900', fontSize: 24, flex: 1 },
  sheetCoords: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4 },
  sheetFavBtn: { 
    width: 54, height: 54, borderRadius: 27, 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
  },
  sheetFavBtnActive: { backgroundColor: COLORS.warning, borderColor: COLORS.warning },
  sheetActions: { marginTop: 8 },
  mainActionBtn: { 
    backgroundColor: COLORS.primary, padding: 20, borderRadius: 22, 
    alignItems: 'center', ...SHADOWS.light 
  },
  mainActionText: { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 1.5 },

  panelSafe: { flex: 1 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, paddingBottom: 10 },
  panelTitle: { fontSize: 32, fontWeight: '900', color: COLORS.text },
  closeBtn: { width: 40, height: 40, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  closeText: { color: COLORS.text, fontSize: 18 },
  list: { paddingHorizontal: 20 },
  item: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', 
    padding: 16, borderRadius: 24, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' 
  },
  itemMain: { flex: 1 },
  itemName: { color: COLORS.text, fontWeight: '800', fontSize: 16 },
  itemCoords: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  itemActions: { flexDirection: 'row', gap: 8 },
  editBtn: { padding: 8, backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 10 },
  deleteBtn: { padding: 8, backgroundColor: 'rgba(244, 63, 94, 0.08)', borderRadius: 10 },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40, fontWeight: '600', fontSize: 14, opacity: 0.5 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12, paddingLeft: 5, opacity: 0.7 },
  itemHistory: { opacity: 0.8, paddingVertical: 12 }
});
