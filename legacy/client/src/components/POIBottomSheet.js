import React, { useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, PanResponder, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS } from '../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = 280;

export default function POIBottomSheet({ visible, point, onTeleport, onRoute, onClose }) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? SCREEN_HEIGHT - SHEET_HEIGHT : SCREEN_HEIGHT,
      useNativeDriver: true,
      friction: 8
    }).start();
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(SCREEN_HEIGHT - SHEET_HEIGHT + gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100) {
          onClose();
        } else {
          Animated.spring(translateY, {
            toValue: SCREEN_HEIGHT - SHEET_HEIGHT,
            useNativeDriver: true,
            friction: 8
          }).start();
        }
      }
    })
  ).current;

  if (!point && !visible) return null;

  return (
    <Animated.View 
      style={[
        styles.sheet, 
        SHADOWS.premium,
        { transform: [{ translateY }] }
      ]}
    >
      <View {...panResponder.panHandlers} style={styles.handleBar}>
        <View style={styles.handle} />
      </View>

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.titleCol}>
            <Text style={styles.title} numberOfLines={1}>{point?.name || 'Point sélectionné'}</Text>
            <Text style={styles.subtitle}>{point?.latitude.toFixed(5)}, {point?.longitude.toFixed(5)}</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close-circle" size={28} color="rgba(255,255,255,0.1)" />
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.primary }]} onPress={() => onRoute(point)}>
            <View style={styles.iconCircle}>
              <Ionicons name="navigate" size={24} color="#fff" />
            </View>
            <Text style={styles.actionText}>Itinéraire</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => onTeleport(point)}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
              <Ionicons name="flash" size={24} color="#fff" />
            </View>
            <Text style={styles.actionText}>Téléport</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => {}}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
              <Ionicons name="star-outline" size={24} color="#fff" />
            </View>
            <Text style={styles.actionText}>Favori</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => {}}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
              <Ionicons name="share-outline" size={24} color="#fff" />
            </View>
            <Text style={styles.actionText}>Partager</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.footer}>
           <Text style={styles.footerText}>Coordonnées GPS précises pour injection</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SHEET_HEIGHT + 100, // Extra for safe area/overscroll
    backgroundColor: 'rgba(30, 41, 59, 0.98)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 200,
    paddingBottom: 40
  },
  handleBar: {
    width: '100%',
    height: 30,
    alignItems: 'center',
    justifyContent: 'center'
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2
  },
  content: {
    paddingHorizontal: 20,
    flex: 1
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 25
  },
  titleCol: {
    flex: 1
  },
  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: 2
  },
  closeBtn: {
    padding: 5
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 25
  },
  actionBtn: {
    alignItems: 'center',
    gap: 8,
    width: 75
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center'
  },
  actionText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600'
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 15
  },
  footerText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center'
  }
});
