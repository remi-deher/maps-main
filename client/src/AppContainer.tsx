import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, Platform, TouchableOpacity, Text, Animated, Easing } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';

// Modules locaux
import { COLORS, SHADOWS } from './constants/theme';
import { useAppStore } from './store/useAppStore';
import { useLocation } from './hooks/useLocation';
import { logEvent } from './services/logger';
import Omnibar from './components/Omnibar';
import SettingsModal from './components/SettingsModal';
import DebugModal from './components/DebugModal';
import SequenceModal from './components/SequenceModal';
import { ActionPanel, FavoritesPanel, QuickFavorites } from './components/Panels';
import { Coords } from './types';

export default function AppContainer() {
  const store = useAppStore();
  const { isMaintaining, requestPermissions, toggleBackground, searchAddress, reverseGeocode } = useLocation();
  
  // États UI locaux
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingCoords, setPendingCoords] = useState<Coords | null>(null);
  const [simulatedAddress, setSimulatedAddress] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showSequence, setShowSequence] = useState(false);
  const [isFavsOpen, setIsFavsOpen] = useState(false);
  const [isLowPowerMode, setIsLowPowerMode] = useState(false);
  const [mapType, setMapType] = useState<'hybrid' | 'standard'>('hybrid');
  
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 3.5, duration: 2500, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
          Animated.timing(pulseScale, { toValue: 1, duration: 0, useNativeDriver: true })
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0, duration: 2500, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
          Animated.timing(pulseOpacity, { toValue: 0.4, duration: 0, useNativeDriver: true })
        ])
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const mapRef = useRef<MapView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => {
    requestPermissions();
    requestCameraPermission();

    const checkBattery = async () => {
      const isLowPower = await Battery.isLowPowerModeEnabledAsync();
      setIsLowPowerMode(isLowPower);
    };
    checkBattery();
    const batterySub = Battery.addLowPowerModeListener(({ lowPowerMode }) => {
      setIsLowPowerMode(lowPowerMode);
    });

    const watchSub = Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 10 },
      (loc) => {
        store.reportRealLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude
        });
      }
    );

    return () => {
      batterySub.remove();
      watchSub.then(sub => sub.remove());
    };
  }, []);

  useEffect(() => {
    if (store.simulatedCoords) {
      reverseGeocode(store.simulatedCoords.latitude, store.simulatedCoords.longitude).then(setSimulatedAddress);
      mapRef.current?.animateToRegion({ ...store.simulatedCoords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
    } else {
      setSimulatedAddress(null);
    }
  }, [store.simulatedCoords]);

  const handleTeleport = (coords: Coords) => {
    store.sendAction('SET_LOCATION', { lat: coords.latitude, lon: coords.longitude, name: coords.name || "" });
    setPendingCoords(null);
    setIsFavsOpen(false);
  };

  const handleSearch = async () => {
    const coords = await searchAddress(searchQuery);
    if (coords) {
      setPendingCoords(coords);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
    }
    Keyboard.dismiss();
  };

  if (showScanner) {
    return (
      <View style={styles.scanner}>
        <CameraView onBarcodeScanned={({data}) => {
          setShowScanner(false);
          const match = data.match(/http:\/\/([^:]+):(\d+)/);
          if (match) store.setSettings(match[1], match[2]);
        }} style={StyleSheet.absoluteFill} />
        <TouchableOpacity style={styles.closeScanner} onPress={() => setShowScanner(false)}><Text style={styles.closeText}>ANNULER</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            mapType={mapType}
            initialRegion={{ latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
            onLongPress={async (e) => {
              const coords = e.nativeEvent.coordinate;
              const address = await reverseGeocode(coords.latitude, coords.longitude);
              setPendingCoords({ ...coords, name: address });
            }}
          >
            {store.simulatedCoords && (
              <Marker coordinate={store.simulatedCoords} anchor={{x: 0.5, y: 0.5}} flat={false}>
                <View style={styles.markerContainer}>
                  <Animated.View style={[styles.pulseHalo, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
                  <View style={styles.blueDot} />
                </View>
              </Marker>
            )}
            {pendingCoords && <Marker coordinate={pendingCoords} pinColor={COLORS.error} />}
          </MapView>

          <View style={styles.omnibarContainer}>
            <Omnibar 
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSearchSubmit={handleSearch}
                onScannerPress={() => setShowScanner(true)}
                onSettingsPress={() => setShowSettings(true)}
                onDebugPress={() => setShowDebug(true)}
                onSuggestionSelect={(coords: any) => {
                  setPendingCoords(coords);
                  mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
                  setSearchQuery('');
                }}
                status={store.status}
                isMaintaining={isMaintaining}
                isLowPowerMode={isLowPowerMode}
            />
          </View>

          <View style={styles.floatingActions}>
            <TouchableOpacity style={[styles.floatBtn, isMaintaining && styles.activeFloat, SHADOWS.light]} onPress={toggleBackground}>
              <Text style={{fontSize: 22}}>{isMaintaining ? '🛡️' : '💤'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.floatBtn, SHADOWS.light]} onPress={() => setIsFavsOpen(true)}>
              <Text style={{fontSize: 22}}>⭐</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.floatBtn, SHADOWS.light]} onPress={() => setMapType(m => m === 'hybrid' ? 'standard' : 'hybrid')}>
              <Text style={{fontSize: 22}}>{mapType === 'hybrid' ? '🗺️' : '🛰️'}</Text>
            </TouchableOpacity>
          </View>

          <QuickFavorites favorites={store.serverStatus?.favorites || []} onTeleport={handleTeleport} visible={!pendingCoords && !isFavsOpen} />

          {store.simulatedCoords && (
            <TouchableOpacity style={[styles.simPill, SHADOWS.premium]} activeOpacity={0.8}>
              <View style={styles.simPillIcon}><Text style={{fontSize: 12}}>🚀</Text></View>
              <Text style={styles.simPillText} numberOfLines={1}>{simulatedAddress || 'Simulation active'}</Text>
            </TouchableOpacity>
          )}

          <ActionPanel 
            visible={!!pendingCoords} 
            coords={pendingCoords} 
            isFavorite={false}
            onTeleport={handleTeleport}
            onToggleFavorite={() => {}}
            onStartRoute={() => {}}
            onStartOsrmRoute={() => {}}
            onClose={() => setPendingCoords(null)}
          />

          <FavoritesPanel 
            visible={isFavsOpen}
            favorites={store.serverStatus?.favorites || []}
            history={store.serverStatus?.recentHistory || []}
            onClose={() => setIsFavsOpen(false)}
            onTeleport={handleTeleport}
            onRemove={(f: any) => store.sendAction('REMOVE_FAVORITE', { lat: f.lat, lon: f.lon })}
            onRename={(f: any, newName: string) => store.sendAction('RENAME_FAVORITE', { lat: f.lat, lon: f.lon, newName })}
          />

          <SettingsModal 
            visible={showSettings}
            onClose={() => setShowSettings(false)}
            initialIp={store.serverIp}
            initialPort={store.serverPort}
            initialUsbDriver={store.serverStatus?.usbDriver || 'pymobiledevice'}
            initialWifiDriver={store.serverStatus?.wifiDriver || 'pymobiledevice'}
            status={store.status}
            deviceInfo={store.serverStatus?.deviceInfo}
            connectionType={store.serverStatus?.connectionType}
            rsdAddress={store.serverStatus?.rsdAddress}
            onSave={(data: any) => { 
                if (typeof data === 'string') store.setSettings(data, store.serverPort);
                else store.sendAction('SAVE_SETTINGS', data);
                setShowSettings(false); 
            }}
            onImportGpx={(content: string) => store.sendAction('PLAY_CUSTOM_GPX', { gpxContent: content })}
          />

          <SequenceModal visible={showSequence} onClose={() => setShowSequence(false)} currentCoords={store.simulatedCoords} onStart={(legs: any) => store.sendAction('PLAY_SEQUENCE', { legs })} />
          <DebugModal visible={showDebug} onClose={() => setShowDebug(false)} />
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  omnibarContainer: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  scanner: { flex: 1, backgroundColor: '#000' },
  closeScanner: { position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: COLORS.primary, padding: 20, borderRadius: 30 },
  closeText: { color: COLORS.text, fontWeight: 'bold' },
  markerContainer: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center' },
  blueDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#007AFF', borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 3, elevation: 5 },
  pulseHalo: { position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: '#007AFF' },
  floatingActions: { position: 'absolute', top: 160, right: 15, gap: 10 },
  floatBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  activeFloat: { borderColor: COLORS.primary, backgroundColor: 'rgba(99,102,241,0.3)' },
  simPill: { position: 'absolute', bottom: 40, left: 20, right: 20, backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: 20, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.4)', zIndex: 90 },
  simPillIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(99, 102, 241, 0.2)', justifyContent: 'center', alignItems: 'center' },
  simPillText: { color: COLORS.text, fontSize: 14, fontWeight: '700', flex: 1 },
});
