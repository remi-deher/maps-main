import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, Platform, TouchableOpacity, Text, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Circle, Polygon, Polyline } from 'react-native-maps';
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

  const isFavorite = (lat: number, lon: number) => (store.serverStatus?.favorites || []).some((f: any) => Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001);

  const toggleFavorite = (coords: Coords) => {
    if (isFavorite(coords.latitude, coords.longitude)) {
      store.sendAction('REMOVE_FAVORITE', { lat: coords.latitude, lon: coords.longitude });
    } else {
      store.sendAction('ADD_FAVORITE', { name: coords.name || "Lieu favori", lat: coords.latitude, lon: coords.longitude });
    }
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
          // Regex plus souple pour supporter ws:// ou http://
          const match = data.match(/(?:ws|http):\/\/([^:]+):(\d+)/);
          if (match) {
            store.setSettings(match[1], String(match[2]));
          } else {
            // Si c'est juste une IP:Port sans protocole
            const directMatch = data.match(/^([^:]+):(\d+)$/);
            if (directMatch) store.setSettings(directMatch[1], String(directMatch[2]));
          }
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
            
            {/* 📍 Point de position RÉELLE (Discret) */}
            {store.realCoords && (
              <Marker coordinate={store.realCoords} anchor={{x: 0.5, y: 0.5}}>
                <View style={styles.realDotOutline}>
                  <View style={styles.realDotInner} />
                </View>
              </Marker>
            )}
 
            {/* 🛣️ APERÇU DE L'ITINÉRAIRE (SÉQUENCEUR) 🛣️ */}
            {store.sequencePoints.length > 0 && (
              <>
                {/* Segments (Polyline) */}
                {store.sequencePoints.map((p, i) => {
                  if (i === 0 || !p.path || p.path.length < 2) return null;
                  return (
                    <Polyline 
                      key={`path-${p.id}`}
                      coordinates={p.path.map((pt: any) => ({ latitude: pt.lat, longitude: pt.lon }))}
                      strokeColor={COLORS.primary}
                      strokeWidth={3}
                    />
                  );
                })}
                
                {/* Étapes (Markers draggables) */}
                {store.sequencePoints.map((p, i) => {
                  const isStart = i === 0;
                  const isEnd = i === store.sequencePoints.length - 1;
                  const color = isStart ? COLORS.primary : (isEnd ? COLORS.error : COLORS.success);
                  
                  return (
                    <Marker 
                      key={`step-${p.id}`}
                      coordinate={{ latitude: p.lat, longitude: p.lon }}
                      draggable
                      onDragEnd={(e) => {
                        const newPoints = [...store.sequencePoints];
                        newPoints[i] = { ...newPoints[i], latitude: e.nativeEvent.coordinate.latitude, longitude: e.nativeEvent.coordinate.longitude, lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude };
                        store.syncSequence(newPoints);
                      }}
                    >
                      <View style={[styles.stepMarker, { backgroundColor: color }]} />
                    </Marker>
                  );
                })}
              </>
            )}

            {pendingCoords && <Marker coordinate={pendingCoords} pinColor={COLORS.error} />}

            {/* ⭐ FAVORIS SUR LA CARTE ⭐ */}
            {(store.serverStatus?.favorites || []).map((fav: any, i: number) => (
              <Marker 
                key={`fav-marker-${i}`}
                coordinate={{ latitude: fav.lat, longitude: fav.lon }}
                onPress={() => setPendingCoords({ latitude: fav.lat, longitude: fav.lon, name: fav.name })}
              >
                <View style={styles.favMarker} />
              </Marker>
            ))}

            {/* 🛡️ ZONE DE PATROUILLE 🛡️ */}
            {store.serverStatus?.patrolZone && (
              <>
                {store.serverStatus.patrolZone.type === 'circle' ? (
                  <>
                    <Circle 
                      center={store.serverStatus.patrolZone.center}
                      radius={store.serverStatus.patrolZone.radius || 200}
                      fillColor={store.serverStatus.patrolZone.active ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)'}
                      strokeColor={store.serverStatus.patrolZone.active ? '#10b981' : '#64748b'}
                      strokeWidth={2}
                      lineDashPattern={[5, 10]}
                    />
                    {/* Handles Circle */}
                    <Marker 
                      coordinate={store.serverStatus.patrolZone.center}
                      draggable
                      onDrag={(e) => store.updatePatrolZone({ ...store.serverStatus!.patrolZone, center: e.nativeEvent.coordinate })}
                    >
                      <View style={{ width: 12, height: 12, backgroundColor: 'white', borderRadius: 6, borderSize: 2, borderColor: '#10b981' }} />
                    </Marker>
                  </>
                ) : (
                  store.serverStatus.patrolZone.bounds && (
                    <>
                      <Polygon 
                        coordinates={[
                          { latitude: store.serverStatus.patrolZone.bounds.ne.lat, longitude: store.serverStatus.patrolZone.bounds.sw.lon },
                          { latitude: store.serverStatus.patrolZone.bounds.ne.lat, longitude: store.serverStatus.patrolZone.bounds.ne.lon },
                          { latitude: store.serverStatus.patrolZone.bounds.sw.lat, longitude: store.serverStatus.patrolZone.bounds.ne.lon },
                          { latitude: store.serverStatus.patrolZone.bounds.sw.lat, longitude: store.serverStatus.patrolZone.bounds.sw.lon }
                        ]}
                        fillColor={store.serverStatus.patrolZone.active ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)'}
                        strokeColor={store.serverStatus.patrolZone.active ? '#10b981' : '#64748b'}
                        strokeWidth={2}
                        lineDashPattern={[5, 10]}
                      />
                      {/* Handles Rectangle (SW and NE corners) */}
                      <Marker 
                        coordinate={{ latitude: store.serverStatus.patrolZone.bounds.sw.lat, longitude: store.serverStatus.patrolZone.bounds.sw.lon }}
                        draggable
                        onDrag={(e) => store.updatePatrolZone({ 
                          ...store.serverStatus!.patrolZone, 
                          bounds: { ...store.serverStatus!.patrolZone!.bounds!, sw: { lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude } } 
                        })}
                      >
                        <View style={{ width: 12, height: 12, backgroundColor: 'white', borderSize: 2, borderColor: '#10b981' }} />
                      </Marker>
                      <Marker 
                        coordinate={{ latitude: store.serverStatus.patrolZone.bounds.ne.lat, longitude: store.serverStatus.patrolZone.bounds.ne.lon }}
                        draggable
                        onDrag={(e) => store.updatePatrolZone({ 
                          ...store.serverStatus!.patrolZone, 
                          bounds: { ...store.serverStatus!.patrolZone!.bounds!, ne: { lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude } } 
                        })}
                      >
                        <View style={{ width: 12, height: 12, backgroundColor: 'white', borderSize: 2, borderColor: '#10b981' }} />
                      </Marker>
                    </>
                  )
                )}
              </>
            )}
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
                telemetry={store.serverStatus?.telemetry}
            />
          </View>

          <View style={styles.floatingActions}>
            <TouchableOpacity style={[styles.floatBtn, isMaintaining && styles.activeFloat, SHADOWS.light]} onPress={toggleBackground}>
              <Ionicons name={isMaintaining ? "shield-checkmark" : "shield-outline"} size={24} color={isMaintaining ? COLORS.primary : COLORS.text} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.floatBtn, SHADOWS.light]} 
              onPress={async () => {
                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                mapRef.current?.animateToRegion({
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01
                }, 800);
              }}
            >
              <Ionicons name="locate" size={24} color={COLORS.text} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.floatBtn, SHADOWS.light]} onPress={() => setIsFavsOpen(true)}>
              <Ionicons name="star-outline" size={24} color={COLORS.text} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.floatBtn, SHADOWS.light]} onPress={() => setMapType(m => m === 'hybrid' ? 'standard' : 'hybrid')}>
              <Ionicons name={mapType === 'hybrid' ? "map-outline" : "earth-outline"} size={24} color={COLORS.text} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.floatBtn, SHADOWS.light]} onPress={() => setShowSequence(true)}>
              <Ionicons name="airplane-outline" size={24} color={COLORS.text} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[
                styles.floatBtn, 
                store.simulatedCoords ? { backgroundColor: 'rgba(244, 63, 94, 0.2)', borderColor: '#f43f5e' } : { backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: '#f59e0b' },
                SHADOWS.light
              ]} 
              onPress={() => {
                if (store.simulatedCoords) {
                  store.sendAction('CLEAR_LOCATION');
                } else {
                  store.sendAction('RELANCE');
                }
              }}
            >
              <Ionicons 
                name={store.simulatedCoords ? "refresh-circle" : "flash"} 
                size={26} 
                color={store.simulatedCoords ? '#f43f5e' : '#f59e0b'} 
              />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.floatBtn, store.serverStatus?.patrolZone?.active && styles.activeFloat, SHADOWS.light]} 
              onPress={() => {
                const zone = store.serverStatus?.patrolZone;
                if (!zone) {
                  store.updatePatrolZone({
                    type: 'circle',
                    center: store.simulatedCoords || { latitude: 48.8566, longitude: 2.3522 },
                    radius: 200,
                    active: false
                  });
                } else {
                  store.updatePatrolZone({ ...zone, active: !zone.active });
                }
              }}
            >
              <Ionicons 
                name={store.serverStatus?.patrolZone?.active ? "radio-outline" : "ellipse-outline"} 
                size={24} 
                color={store.serverStatus?.patrolZone?.active ? COLORS.primary : COLORS.text} 
              />
            </TouchableOpacity>
          </View>

          <QuickFavorites favorites={store.serverStatus?.favorites || []} onTeleport={handleTeleport} visible={!pendingCoords && !isFavsOpen} />

          {store.simulatedCoords && (
            <TouchableOpacity style={[styles.simPill, SHADOWS.premium]} activeOpacity={0.8}>
              <View style={styles.simPillIcon}>
                <Ionicons name="navigate" size={14} color={COLORS.primary} />
              </View>
              <Text style={styles.simPillText} numberOfLines={1}>{simulatedAddress || 'Simulation active'}</Text>
            </TouchableOpacity>
          )}

          {/* Navigation HUD (Floating) */}
          {store.serverStatus?.navigation?.status?.state === 'running' && store.simulatedCoords && (
            <Animated.View style={[styles.navHud, SHADOWS.premium]}>
              <View style={styles.navHudLeft}>
                <Text style={styles.navHudLabel}>Vitesse</Text>
                <View style={{flexDirection: 'row', alignItems: 'baseline'}}>
                  <Text style={styles.navHudSpeed}>{store.serverStatus?.navigation?.progress?.speed || 0}</Text>
                  <Text style={styles.navHudUnit}>km/h</Text>
                </View>
              </View>
              
              <View style={styles.navHudDivider} />
              
              <View style={styles.navHudCenter}>
                <View style={styles.navHudHeader}>
                  <Text style={styles.navHudState}>EN MOUVEMENT</Text>
                  <Text style={styles.navHudLeg}>
                    Étape {store.serverStatus?.navigation?.progress?.index + 1}/{store.serverStatus?.navigation?.progress?.total}
                  </Text>
                </View>
                <View style={styles.navProgressBg}>
                  <View style={[styles.navProgressFill, { width: `${((store.serverStatus?.navigation?.progress?.index || 0) / (store.serverStatus?.navigation?.progress?.total || 1)) * 100}%` }]} />
                </View>
              </View>

              <TouchableOpacity style={styles.navHudClose} onPress={() => store.sendAction('STOP_ROUTE')}>
                <Ionicons name="close" size={20} color="#f43f5e" />
              </TouchableOpacity>
            </Animated.View>
          )}

          <ActionPanel 
            visible={!!pendingCoords} 
            coords={pendingCoords} 
            isFavorite={pendingCoords ? isFavorite(pendingCoords.latitude, pendingCoords.longitude) : false}
            onTeleport={handleTeleport}
            onToggleFavorite={() => pendingCoords && toggleFavorite(pendingCoords)}
            onStartRoute={() => {
              if (!pendingCoords) return;
              store.sendAction('PLAY_ROUTE', { endLat: pendingCoords.latitude, endLon: pendingCoords.longitude, speed: 5 });
              setPendingCoords(null);
            }}
            onStartOsrmRoute={(profile: string) => {
              if (!pendingCoords) return;
              store.sendAction('PLAY_OSRM_ROUTE', { endLat: pendingCoords.latitude, endLon: pendingCoords.longitude, profile });
              setPendingCoords(null);
            }}
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
            initialNotifications={store.notificationsEnabled}
            initialDynamicIsland={store.dynamicIslandEnabled}
            status={store.status}
            deviceInfo={store.serverStatus?.deviceInfo}
            connectionType={store.serverStatus?.connectionType}
            rsdAddress={store.serverStatus?.rsdAddress}
            onSave={(data: any) => { 
                if (typeof data === 'string') {
                  store.setSettings(data, store.serverPort);
                } else {
                  // Sauvegarde locale de l'IP et du Port s'ils sont fournis dans l'objet
                  if (data.wifiIp && data.companionPort) {
                    store.setSettings(data.wifiIp, data.companionPort);
                  }
                  store.sendAction('SAVE_SETTINGS', data);
                }
                setShowSettings(false); 
            }}
            onImportGpx={(content: string) => store.sendAction('PLAY_CUSTOM_GPX', { gpxContent: content })}
          />

          <SequenceModal 
            visible={showSequence} 
            onClose={() => setShowSequence(false)} 
            currentCoords={store.simulatedCoords} 
            points={store.sequencePoints}
            onSync={store.syncSequence}
            onStart={(legs: any) => store.sendAction('PLAY_SEQUENCE', { legs })} 
          />
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
  realDotOutline: { width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(255, 255, 255, 0.8)', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2, elevation: 3 },
  realDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34D399' }, // Vert pour bien distinguer du bleu simulé
  stepMarker: { width: 14, height: 14, borderRadius: 7, borderSize: 2, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2, elevation: 3 },
  favMarker: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FBBF24', borderWidth: 2, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 1.5, elevation: 2 },
  
  navHud: { position: 'absolute', bottom: 120, left: 15, right: 15, backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: 24, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.3)', zIndex: 100 },
  navHudLeft: { alignItems: 'center', paddingRight: 15 },
  navHudLabel: { color: COLORS.primary, fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  navHudSpeed: { color: COLORS.text, fontSize: 24, fontWeight: '900' },
  navHudUnit: { color: COLORS.textSecondary, fontSize: 10, marginLeft: 2 },
  navHudDivider: { width: 1, height: '80%', backgroundColor: 'rgba(255,255,255,0.1)' },
  navHudCenter: { flex: 1, paddingHorizontal: 15 },
  navHudHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  navHudState: { color: COLORS.success, fontSize: 8, fontWeight: '900' },
  navHudLeg: { color: COLORS.textSecondary, fontSize: 8, fontWeight: '700' },
  navProgressBg: { height: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' },
  navProgressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },
  navHudClose: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(244, 63, 94, 0.1)', justifyContent: 'center', alignItems: 'center' },
});
