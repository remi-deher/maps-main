import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, TextInput, KeyboardAvoidingView, 
  Platform, Alert, Animated, PanResponder, Dimensions, TouchableOpacity, ActivityIndicator,
  TouchableWithoutFeedback, Keyboard, ScrollView
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LOCATION_TASK_NAME = 'background-location-task';
const DEFAULT_PORT = '8080';

// Bus d'événement global
const eventBus = {
  listeners: [],
  subscribe(cb) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter(l => l !== cb); } },
  emit(data) { this.listeners.forEach(cb => cb(data)) }
};

TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
  if (error) return;
  if (data) eventBus.emit({ type: 'TICK' });
});

export default function App() {
  // États de connexion
  const [isMaintaining, setIsMaintaining] = useState(false);
  const [serverIp, setServerIp] = useState('');
  const [serverPort, setServerPort] = useState(DEFAULT_PORT);
  const [wsStatus, setWsStatus] = useState('Déconnecté');
  const [pcTunnelActive, setPcTunnelActive] = useState(false);
  const [simulatedCoords, setSimulatedCoords] = useState(null);
  const [pendingCoords, setPendingCoords] = useState(null);
  
  // États de stockage
  const [history, setHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);

  // États Recherche & Scanner
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [showScanner, setShowScanner] = useState(false);

  // États UI
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef(null);
  const ws = useRef(null);
  const isConnecting = useRef(false);

  // Joystick Logic
  const [joystickActive, setJoystickActive] = useState(false);
  const joystickPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const joystickTimer = useRef(null);

  // ─── Initialisation & Persistance ───────────────────────────────────────────

  useEffect(() => {
    (async () => {
      await Location.requestForegroundPermissionsAsync();
      requestCameraPermission();

      // Charger tout le stockage
      const savedIp = await AsyncStorage.getItem('serverIp');
      const savedPort = await AsyncStorage.getItem('serverPort');
      const savedHist = await AsyncStorage.getItem('history');
      const savedFavs = await AsyncStorage.getItem('favorites');

      if (savedIp) {
        setServerIp(savedIp);
        setServerPort(savedPort || DEFAULT_PORT);
      }
      if (savedHist) setHistory(JSON.parse(savedHist));
      if (savedFavs) setFavorites(JSON.parse(savedFavs));
    })();

    const unsubscribe = eventBus.subscribe((ev) => {
      if (ev.type === 'TICK' && isMaintaining) sendHeartbeat(true);
    });

    return () => {
      unsubscribe();
      stopWs();
      if (joystickTimer.current) clearInterval(joystickTimer.current);
    };
  }, [isMaintaining]);

  // Sauvegarde auto
  useEffect(() => {
    AsyncStorage.setItem('history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    AsyncStorage.setItem('favorites', JSON.stringify(favorites));
  }, [favorites]);

  // ─── Logique Joystick (Vitesse Pro) ────────────────────────────────────────

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setJoystickActive(true);
      },
      onPanResponderMove: (evt, gestureState) => {
        const dist = Math.sqrt(gestureState.dx**2 + gestureState.dy**2);
        const maxDist = 45;
        
        if (dist > maxDist) {
          const ratio = maxDist / dist;
          joystickPos.setValue({ x: gestureState.dx * ratio, y: gestureState.dy * ratio });
        } else {
          joystickPos.setValue({ x: gestureState.dx, y: gestureState.dy });
        }
        
        startJoystickMovement(gestureState.dx, gestureState.dy);
      },
      onPanResponderRelease: () => {
        Animated.spring(joystickPos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        setJoystickActive(false);
        stopJoystickMovement();
      },
    })
  ).current;

  const startJoystickMovement = (dx, dy) => {
    if (joystickTimer.current) clearInterval(joystickTimer.current);
    joystickTimer.current = setInterval(() => {
      // Sensibilité Pro : 0.000015
      moveSimulatedLocation(dx * 0.000015, -dy * 0.000015);
    }, 40); // 25 FPS pour une fluidité parfaite
  };

  const stopJoystickMovement = () => {
    if (joystickTimer.current) clearInterval(joystickTimer.current);
  };

  const moveSimulatedLocation = (dLat, dLon) => {
    setSimulatedCoords(prev => {
      if (!prev) return null;
      const next = { latitude: prev.latitude + dLat, longitude: prev.longitude + dLon };
      sendLocationToPc(next.latitude, next.longitude);
      return next;
    });
  };

  // ─── Logique WebSocket ──────────────────────────────────────────────────────

  const connectWs = async () => {
    if (!serverIp || isConnecting.current) return;
    stopWs();
    isConnecting.current = true;
    setWsStatus('Connexion...');

    try {
      ws.current = new WebSocket(`ws://${serverIp}:${serverPort}`);
      ws.current.onopen = () => {
        isConnecting.current = false;
        setWsStatus('Connecté');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        sendHeartbeat(isMaintaining);
        AsyncStorage.setItem('serverIp', serverIp);
        AsyncStorage.setItem('serverPort', serverPort);
      };
      ws.current.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'STATUS') {
            setPcTunnelActive(payload.data.tunnelActive);
          } else if (payload.type === 'LOCATION') {
            const nextCoords = { latitude: payload.data.lat, longitude: payload.data.lon };
            setSimulatedCoords(nextCoords);
            mapRef.current?.animateToRegion({ ...nextCoords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
          }
        } catch (err) { }
      };
      ws.current.onclose = () => {
        isConnecting.current = false;
        setWsStatus('Déconnecté');
        setPcTunnelActive(false);
      };
      ws.current.onerror = () => { isConnecting.current = false; setWsStatus('Erreur'); };
    } catch (e) { isConnecting.current = false; setWsStatus('Erreur'); }
  };

  const stopWs = () => { if (ws.current) { ws.current.close(); ws.current = null; } };

  const sendHeartbeat = (maintaining) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'HEARTBEAT', data: { isMaintaining: maintaining } }));
    }
  };

  const sendLocationToPc = (lat, lon) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'SET_LOCATION', data: { lat, lon } }));
    }
  };

  // ─── Actions ────────────────────────────────────────────────────────────────

  const addToHistory = (coords) => {
    setHistory(prev => {
      const filtered = prev.filter(h => Math.abs(h.latitude - coords.latitude) > 0.001);
      return [coords, ...filtered].slice(0, 10);
    });
  };

  const toggleFavorite = (coords) => {
    const exists = favorites.some(f => Math.abs(f.latitude - coords.latitude) < 0.0001);
    if (exists) {
      setFavorites(prev => prev.filter(f => Math.abs(f.latitude - coords.latitude) > 0.0001));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      setFavorites(prev => [...prev, coords]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const teleportTo = (coords) => {
    sendLocationToPc(coords.latitude, coords.longitude);
    setPendingCoords(null);
    addToHistory(coords);
    if (isMenuOpen) toggleMenu();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleBarCodeScanned = ({ data }) => {
    setShowScanner(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      if (data.startsWith('{')) {
        const config = JSON.parse(data);
        if (config.ip) {
          setServerIp(config.ip);
          setServerPort(config.port || DEFAULT_PORT);
          return;
        }
      }
      const match = data.match(/ws:\/\/([^:]+):(\d+)/);
      if (match) {
        setServerIp(match[1]);
        setServerPort(match[2]);
      } else {
        // Fallback simple si c'est juste l'IP
        setServerIp(data);
      }
    } catch (e) { Alert.alert("Erreur", "Données QR invalides."); }
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    setIsSearching(true);
    try {
      const results = await Location.geocodeAsync(searchQuery);
      if (results.length > 0) {
        const newCoords = { latitude: results[0].latitude, longitude: results[0].longitude };
        setPendingCoords(newCoords);
        mapRef.current?.animateToRegion({ ...newCoords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
      }
    } catch (e) { Alert.alert("Erreur", "Lieu introuvable."); }
    finally { setIsSearching(false); Keyboard.dismiss(); }
  };

  const toggleMenu = () => {
    const toValue = isMenuOpen ? 0 : 1;
    Animated.spring(menuAnim, { toValue, useNativeDriver: false, friction: 8 }).start();
    setIsMenuOpen(!isMenuOpen);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ─── Rendu ──────────────────────────────────────────────────────────────────

  if (showScanner) {
    return (
      <View style={styles.scannerContainer}>
        <CameraView 
          onBarcodeScanned={handleBarCodeScanned} 
          barcodeScannerSettings={{
            barcodeTypes: ["qr"],
          }}
          style={StyleSheet.absoluteFillObject} 
        />
        <View style={styles.scannerOverlay}>
          <View style={styles.scannerTarget} />
          <Text style={styles.scannerHint}>Scannez le QR Code sur le PC</Text>
        </View>
        <TouchableOpacity style={styles.closeScanner} onPress={() => setShowScanner(false)}>
          <Text style={styles.btnText}>ANNULER</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={{ latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
          onLongPress={(e) => {
             setPendingCoords(e.nativeEvent.coordinate);
             Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }}
          customMapStyle={mapDarkStyle}
        >
          {simulatedCoords && (
            <Marker coordinate={simulatedCoords}>
              <View style={styles.userMarker}>
                <View style={styles.userMarkerPulse} />
                <View style={styles.userMarkerInner} />
              </View>
            </Marker>
          )}
          {pendingCoords && <Marker coordinate={pendingCoords} pinColor="#f43f5e" />}
        </MapView>

        {/* Omnibar */}
        <View style={styles.topContainer}>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder="Chercher une ville, une rue..."
              placeholderTextColor="#475569"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
            />
            <TouchableOpacity onPress={handleSearch} style={styles.searchIconBtn}>
              {isSearching ? <ActivityIndicator size="small" color="#6366f1" /> : <Text style={{fontSize: 20}}>🔍</Text>}
            </TouchableOpacity>
          </View>
        </View>

        {/* Connection Status */}
        <View style={styles.statusContainer}>
          <View style={[styles.statusPill, { borderLeftColor: wsStatus === 'Connecté' ? '#10b981' : '#f43f5e' }]}>
            <View style={[styles.dot, { backgroundColor: wsStatus === 'Connecté' ? '#10b981' : '#f43f5e' }]} />
            <Text style={styles.statusText}>{wsStatus} {pcTunnelActive && '• Tunnel OK'}</Text>
          </View>
        </View>

        {/* Joystick Controller */}
        {wsStatus === 'Connecté' && simulatedCoords && (
          <View style={styles.joystickArea}>
            <View style={styles.joystickBase}>
              <Animated.View 
                {...panResponder.panHandlers}
                style={[styles.joystickHandle, { transform: joystickPos.getTranslateTransform() }]}
              >
                <View style={styles.joystickInner} />
              </Animated.View>
            </View>
          </View>
        )}

        {/* Action Button (Bottom) */}
        {pendingCoords && (
          <TouchableOpacity style={styles.teleportAction} onPress={() => teleportTo(pendingCoords)}>
             <Text style={styles.teleportText}>TÉLÉPORTATION ICI 🚀</Text>
          </TouchableOpacity>
        )}

        {/* Menu FAB */}
        <TouchableOpacity style={[styles.fab, pendingCoords && { bottom: 120 }]} onPress={toggleMenu}>
          <Text style={styles.fabText}>{isMenuOpen ? '✕' : '⚙️'}</Text>
        </TouchableOpacity>

        {/* Sliding Menu */}
        <Animated.View style={[styles.menuOverlay, { 
          transform: [{ translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_HEIGHT, 0] }) }]
        }]}>
          <View style={styles.menuHeader}>
            <Text style={styles.menuTitle}>Menu</Text>
            <TouchableOpacity onPress={toggleMenu}><Text style={styles.menuCloseText}>Fermer</Text></TouchableOpacity>
          </View>
          
          <ScrollView style={styles.menuContent} showsVerticalScrollIndicator={false}>
            <View style={styles.configGroup}>
              <Text style={styles.label}>Connexion PC</Text>
              <View style={styles.inputRow}>
                <TextInput style={[styles.input, { flex: 2 }]} placeholder="IP du PC" placeholderTextColor="#475569" value={serverIp} onChangeText={setServerIp} />
                <TouchableOpacity style={styles.qrBtn} onPress={() => setShowScanner(true)}><Text style={{fontSize: 24}}>📷</Text></TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.button, { backgroundColor: '#6366f1' }]} onPress={connectWs}><Text style={styles.buttonText}>RECONNECTER</Text></TouchableOpacity>
            </View>

            <View style={styles.configGroup}>
              <Text style={styles.label}>Récents</Text>
              {history.length > 0 ? history.map((h, i) => (
                <TouchableOpacity key={i} style={styles.listItem} onPress={() => teleportTo(h)}>
                  <Text style={styles.listItemText}>Position {history.length - i}</Text>
                  <Text style={styles.listItemSub}>{h.latitude.toFixed(4)}, {h.longitude.toFixed(4)}</Text>
                </TouchableOpacity>
              )) : <Text style={styles.emptyText}>Aucun historique</Text>}
            </View>

            <View style={styles.configGroup}>
              <Text style={styles.label}>Service Background</Text>
              <TouchableOpacity 
                style={[styles.button, { backgroundColor: isMaintaining ? '#f43f5e' : '#10b981' }]} 
                onPress={toggleLocationUpdates}
              >
                <Text style={styles.buttonText}>{isMaintaining ? 'ARRÊTER LE SERVICE' : 'DÉMARRER LE SERVICE'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const mapDarkStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#242f3e" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#746855" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#242f3e" }] },
  { "featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
  { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#38414e" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#17263c" }] }
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  map: { width: '100%', height: '100%' },
  userMarker: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  userMarkerPulse: { position: 'absolute', width: 30, height: 30, borderRadius: 15, backgroundColor: '#6366f1', opacity: 0.3 },
  userMarkerInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#6366f1', borderWidth: 2, borderColor: '#fff' },
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  scannerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scannerTarget: { width: 250, height: 250, borderWidth: 2, borderColor: '#6366f1', borderRadius: 40 },
  scannerHint: { color: '#fff', marginTop: 40, fontWeight: 'bold' },
  closeScanner: { position: 'absolute', bottom: 60, alignSelf: 'center', backgroundColor: '#6366f1', paddingHorizontal: 40, paddingVertical: 18, borderRadius: 35 },
  topContainer: { position: 'absolute', top: 60, left: 20, right: 20, zIndex: 10 },
  searchBar: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 25, paddingHorizontal: 20, paddingVertical: 15, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 15 },
  searchInput: { flex: 1, fontSize: 16, color: '#f8fafc', fontWeight: '500' },
  statusContainer: { position: 'absolute', top: 140, alignSelf: 'center', zIndex: 5 },
  statusPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.9)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderLeftWidth: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  statusText: { color: '#f8fafc', fontSize: 12, fontWeight: 'bold' },
  joystickArea: { position: 'absolute', bottom: 140, right: 30, zIndex: 20 },
  joystickBase: { width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(15,23,42,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  joystickHandle: { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(255,255,255,0.1)', padding: 12 },
  joystickInner: { flex: 1, borderRadius: 21, backgroundColor: '#6366f1', shadowColor: '#6366f1', shadowOpacity: 0.6, shadowRadius: 10 },
  teleportAction: { position: 'absolute', bottom: 45, left: 30, right: 110, backgroundColor: '#8b5cf6', padding: 20, borderRadius: 20, alignItems: 'center', shadowColor: '#8b5cf6', shadowOpacity: 0.4, shadowRadius: 15, zIndex: 30 },
  teleportText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  fab: { position: 'absolute', bottom: 45, right: 30, width: 64, height: 64, borderRadius: 32, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 15, zIndex: 30 },
  fabText: { fontSize: 26, color: '#fff' },
  menuOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0f172a', zIndex: 100, padding: 30, paddingTop: 70 },
  menuHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 },
  menuTitle: { fontSize: 32, fontWeight: 'bold', color: '#f8fafc' },
  menuCloseText: { color: '#6366f1', fontWeight: 'bold' },
  menuContent: { flex: 1 },
  configGroup: { marginBottom: 40 },
  label: { color: '#6366f1', fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 15, letterSpacing: 1.5 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  input: { flex: 1, backgroundColor: '#1e293b', color: '#f8fafc', padding: 20, borderRadius: 15, fontSize: 16 },
  qrBtn: { marginLeft: 15, padding: 18, backgroundColor: '#1e293b', borderRadius: 15 },
  button: { padding: 22, borderRadius: 20, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  listItem: { padding: 15, backgroundColor: '#1e293b', borderRadius: 15, marginBottom: 10 },
  listItemText: { color: '#f8fafc', fontWeight: 'bold' },
  listItemSub: { color: '#64748b', fontSize: 12 },
  emptyText: { color: '#475569', italic: true },
  btnText: { color: '#fff', fontWeight: 'bold' }
});
