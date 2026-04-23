import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, TextInput, KeyboardAvoidingView, 
  Platform, Alert, Animated, PanResponder, Dimensions, TouchableOpacity, ActivityIndicator,
  TouchableWithoutFeedback, Keyboard 
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import MapView, { Marker } from 'react-native-maps';
import { BarCodeScanner } from 'expo-barcode-scanner';
import * as Haptics from 'expo-haptics';

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
  // États de connexion et simulation
  const [isMaintaining, setIsMaintaining] = useState(false);
  const [serverIp, setServerIp] = useState('');
  const [serverPort, setServerPort] = useState(DEFAULT_PORT);
  const [wsStatus, setWsStatus] = useState('Déconnecté');
  const [pcTunnelActive, setPcTunnelActive] = useState(false);
  const [simulatedCoords, setSimulatedCoords] = useState(null);
  const [pendingCoords, setPendingCoords] = useState(null);
  
  // États Recherche & Scanner
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(null);
  const [showScanner, setShowScanner] = useState(false);

  // États UI
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef(null);
  const ws = useRef(null);
  const reconnectTimer = useRef(null);
  const isConnecting = useRef(false);

  // ─── Joystick Logic ────────────────────────────────────────────────────────
  const [joystickActive, setJoystickActive] = useState(false);
  const joystickPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const joystickTimer = useRef(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (evt, gestureState) => {
        const dist = Math.sqrt(gestureState.dx**2 + gestureState.dy**2);
        const maxDist = 40;
        
        if (dist > maxDist) {
          const ratio = maxDist / dist;
          joystickPos.setValue({ x: gestureState.dx * ratio, y: gestureState.dy * ratio });
        } else {
          joystickPos.setValue({ x: gestureState.dx, y: gestureState.dy });
        }
        
        if (!joystickActive) setJoystickActive(true);
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
      moveSimulatedLocation(dx * 0.000005, -dy * 0.000005);
    }, 100);
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

  // ─── Initialisation ──────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      await Location.requestForegroundPermissionsAsync();
      const { status: cam } = await BarCodeScanner.requestPermissionsAsync();
      setHasCameraPermission(cam === 'granted');
    })();

    const unsubscribe = eventBus.subscribe(() => {
      if (isMaintaining) sendHeartbeat(true);
    });

    return () => {
      unsubscribe();
      stopWs();
      if (joystickTimer.current) clearInterval(joystickTimer.current);
    };
  }, [isMaintaining]);

  // ─── Logique WebSocket ──────────────────────────────────────────────────────

  const connectWs = () => {
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
      };
      ws.current.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'STATUS') {
            setPcTunnelActive(payload.data.tunnelActive);
          } else if (payload.type === 'LOCATION') {
            const nextCoords = { latitude: payload.data.lat, longitude: payload.data.lon };
            setSimulatedCoords(nextCoords);
            mapRef.current?.animateToRegion({
              ...nextCoords,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            }, 800);
          }
        } catch (err) { console.log('WS JSON Error', err); }
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

  const toggleLocationUpdates = async () => {
    if (isMaintaining) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      setIsMaintaining(false);
      sendHeartbeat(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') return Alert.alert("Permission", "Autorisez l'accès 'Toujours'.");
      
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 1,
        pausesLocationUpdatesAutomatically: false,
        allowsBackgroundLocationUpdates: true,
      });
      setIsMaintaining(true);
      sendHeartbeat(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleBarCodeScanned = ({ data }) => {
    setShowScanner(false);
    try {
      const config = JSON.parse(data);
      if (config.ip) {
        setServerIp(config.ip);
        setServerPort(config.port || DEFAULT_PORT);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) { Alert.alert("Erreur", "QR Code invalide (JSON attendu)."); }
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    setIsSearching(true);
    try {
      const results = await Location.geocodeAsync(searchQuery);
      if (results.length > 0) {
        const newCoords = { latitude: results[0].latitude, longitude: results[0].longitude };
        setPendingCoords(newCoords);
        mapRef.current?.animateToRegion({ ...newCoords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 1000);
      }
    } catch (e) { Alert.alert("Erreur", "Recherche impossible."); }
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
        <BarCodeScanner onBarCodeScanned={handleBarCodeScanned} style={StyleSheet.absoluteFillObject} />
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
          initialRegion={{ latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
          onLongPress={(e) => setPendingCoords(e.nativeEvent.coordinate)}
        >
          {simulatedCoords && <Marker coordinate={simulatedCoords} pinColor="blue" title="Position Active" />}
          {pendingCoords && <Marker coordinate={pendingCoords} pinColor="red" title="Cible" />}
        </MapView>

        {/* Floating Top UI */}
        <View style={styles.topContainer}>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher..."
              placeholderTextColor="#94a3b8"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
            />
            <TouchableOpacity onPress={handleSearch} style={styles.searchIconBtn}>
              {isSearching ? <ActivityIndicator size="small" color="#6366f1" /> : <Text style={{fontSize: 20}}>🔍</Text>}
            </TouchableOpacity>
          </View>
        </View>

        {/* Connection Status Pill */}
        <View style={styles.statusContainer}>
          <View style={[styles.statusPill, { borderLeftColor: wsStatus === 'Connecté' ? '#10b981' : '#f43f5e' }]}>
            <View style={[styles.dot, { backgroundColor: wsStatus === 'Connecté' ? '#10b981' : '#f43f5e' }]} />
            <Text style={styles.statusText}>{wsStatus} {pcTunnelActive && '• Tunnel OK'}</Text>
          </View>
        </View>

        {/* Joystick Controller (Visible only if connected) */}
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

        {/* Floating Action Button (Menu) */}
        <TouchableOpacity style={styles.fab} onPress={toggleMenu}>
          <Text style={styles.fabText}>{isMenuOpen ? '✕' : '⚙️'}</Text>
        </TouchableOpacity>

        {/* Sliding Menu Overlay */}
        <Animated.View style={[styles.menuOverlay, { 
          transform: [{ translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_HEIGHT, 0] }) }]
        }]}>
          <View style={styles.menuHeader}>
            <Text style={styles.menuTitle}>Configuration</Text>
            <TouchableOpacity onPress={toggleMenu}><Text style={styles.menuCloseText}>Fermer</Text></TouchableOpacity>
          </div>
          
          <View style={styles.menuContent}>
            {/* IP/Port Config */}
            <View style={styles.configGroup}>
              <Text style={styles.label}>Adresse du PC</Text>
              <View style={styles.inputRow}>
                <TextInput 
                  style={[styles.input, { flex: 2 }]} 
                  placeholder="192.168.1.XX" 
                  value={serverIp} 
                  onChangeText={setServerIp} 
                />
                <TextInput 
                  style={[styles.input, { flex: 1, marginLeft: 10 }]} 
                  placeholder="8080" 
                  value={serverPort} 
                  onChangeText={setServerPort} 
                />
                <TouchableOpacity style={styles.qrBtn} onPress={() => setShowScanner(true)}>
                  <Text style={{fontSize: 24}}>📷</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity 
                style={[styles.button, { backgroundColor: '#6366f1' }]} 
                onPress={connectWs}
              >
                <Text style={styles.buttonText}>CONNECTER</Text>
              </TouchableOpacity>
            </View>

            {/* Simulation Controls */}
            <View style={styles.configGroup}>
              <Text style={styles.label}>Simulation & Maintenance</Text>
              <TouchableOpacity 
                style={[styles.button, { backgroundColor: isMaintaining ? '#f43f5e' : '#10b981' }]} 
                onPress={toggleLocationUpdates}
              >
                <Text style={styles.buttonText}>{isMaintaining ? 'ARRÊTER LA SURVEILLANCE' : 'ACTIVER LA SURVEILLANCE'}</Text>
              </TouchableOpacity>
              
              {pendingCoords && (
                <TouchableOpacity 
                  style={[styles.button, { backgroundColor: '#8b5cf6', marginTop: 10 }]} 
                  onPress={() => { sendLocationToPc(pendingCoords.latitude, pendingCoords.longitude); setPendingCoords(null); toggleMenu(); }}
                >
                  <Text style={styles.buttonText}>TÉLÉPORTER ICI 🚀</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  map: { width: '100%', height: '100%' },
  
  // Scanner UI
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  closeScanner: { position: 'absolute', bottom: 60, alignSelf: 'center', backgroundColor: '#6366f1', padding: 15, borderRadius: 30 },
  
  // Floating Top UI
  topContainer: { position: 'absolute', top: 50, left: 15, right: 15, zIndex: 10 },
  searchBar: { 
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 20, 
    paddingHorizontal: 15, paddingVertical: 10, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5
  },
  searchInput: { flex: 1, fontSize: 16, color: '#1e293b' },
  searchIconBtn: { marginLeft: 10 },

  // Status Pill
  statusContainer: { position: 'absolute', top: 110, alignSelf: 'center', zIndex: 5 },
  statusPill: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.85)', 
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderLeftWidth: 4
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 8 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },

  // Joystick
  joystickArea: { position: 'absolute', bottom: 120, right: 30, zIndex: 20 },
  joystickBase: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  joystickHandle: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.2)', padding: 10 },
  joystickInner: { flex: 1, borderRadius: 20, backgroundColor: '#6366f1', shadowColor: '#6366f1', shadowOpacity: 0.5, shadowRadius: 5 },

  // FAB
  fab: { 
    position: 'absolute', bottom: 40, right: 20, width: 60, height: 60, 
    borderRadius: 30, backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366f1', shadowOpacity: 0.4, shadowRadius: 10, elevation: 10
  },
  fabText: { fontSize: 24, color: '#fff' },

  // Menu Overlay
  menuOverlay: { 
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
    backgroundColor: '#0f172a', zIndex: 100, padding: 25, paddingTop: 60 
  },
  menuHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  menuTitle: { fontSize: 28, fontWeight: 'bold', color: '#f1f5f9' },
  menuCloseText: { color: '#6366f1', fontWeight: 'bold' },
  menuContent: { flex: 1 },
  
  configGroup: { marginBottom: 30 },
  label: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 10, trackingWidest: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  input: { flex: 1, backgroundColor: '#1e293b', color: '#fff', padding: 15, borderRadius: 12, fontSize: 16 },
  qrBtn: { marginLeft: 10, padding: 10, backgroundColor: '#1e293b', borderRadius: 12 },
  button: { padding: 18, borderRadius: 15, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 5 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  btnText: { color: '#fff', fontWeight: 'bold' }
});
