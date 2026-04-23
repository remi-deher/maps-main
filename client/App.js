import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, TextInput, KeyboardAvoidingView, 
  Platform, Alert, Animated, PanResponder, Dimensions, TouchableOpacity, ActivityIndicator,
  TouchableWithoutFeedback, Keyboard 
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { BarCodeScanner } from 'expo-barcode-scanner';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LOCATION_TASK_NAME = 'background-location-task';
const DEFAULT_PORT = '8080';

// Bus d'événement global pour la communication inter-tâches
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
  const isConnecting = useRef(false);

  // Joystick Logic
  const [joystickActive, setJoystickActive] = useState(false);
  const joystickPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const joystickTimer = useRef(null);

  // ─── Initialisation ──────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      // Permissions
      await Location.requestForegroundPermissionsAsync();
      const { status: cam } = await BarCodeScanner.requestPermissionsAsync();
      setHasCameraPermission(cam === 'granted');

      // Chargement des réglages sauvegardés
      const savedIp = await AsyncStorage.getItem('serverIp');
      const savedPort = await AsyncStorage.getItem('serverPort');
      if (savedIp) {
        setServerIp(savedIp);
        setServerPort(savedPort || DEFAULT_PORT);
      }
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

  // Tentative de connexion auto si l'IP change (et n'est pas vide)
  useEffect(() => {
    if (serverIp && wsStatus === 'Déconnecté' && !isConnecting.current) {
      connectWs();
    }
  }, [serverIp]);

  // ─── Logique Joystick ───────────────────────────────────────────────────────

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setJoystickActive(true);
      },
      onPanResponderMove: (evt, gestureState) => {
        const dist = Math.sqrt(gestureState.dx**2 + gestureState.dy**2);
        const maxDist = 40;
        
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
    
    // Sensibilité accrue : 0.00001 au lieu de 0.000005
    joystickTimer.current = setInterval(() => {
      moveSimulatedLocation(dx * 0.00001, -dy * 0.00001);
    }, 50); // Plus fréquent (50ms) pour plus de fluidité
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
        // Sauvegarder l'IP qui fonctionne
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
            mapRef.current?.animateToRegion({
              ...nextCoords,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            }, 600);
          }
        } catch (err) { /* Erreur JSON ignorée */ }
      };

      ws.current.onclose = () => {
        isConnecting.current = false;
        setWsStatus('Déconnecté');
        setPcTunnelActive(false);
      };

      ws.current.onerror = () => { 
        isConnecting.current = false; 
        setWsStatus('Erreur'); 
      };
    } catch (e) { 
      isConnecting.current = false; 
      setWsStatus('Erreur'); 
    }
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    
    try {
      // Décodage robuste (JSON ou URL)
      if (data.startsWith('{')) {
        const config = JSON.parse(data);
        if (config.ip) {
          setServerIp(config.ip);
          setServerPort(config.port || DEFAULT_PORT);
          return;
        }
      }
      
      // Fallback si c'est une URL type ws://192.168.1.143:8080
      const match = data.match(/ws:\/\/([^:]+):(\d+)/);
      if (match) {
        setServerIp(match[1]);
        setServerPort(match[2]);
      } else {
        Alert.alert("Scan", "Format non reconnu.");
      }
    } catch (e) { 
      Alert.alert("Erreur", "Données QR invalides."); 
    }
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
        <View style={styles.scannerOverlay}>
          <View style={styles.scannerTarget} />
          <Text style={styles.scannerHint}>Scannez le QR Code sur votre PC</Text>
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
            <Marker coordinate={simulatedCoords} title="Ma Position">
              <View style={styles.userMarker}>
                <View style={styles.userMarkerPulse} />
                <View style={styles.userMarkerInner} />
              </View>
            </Marker>
          )}
          {pendingCoords && <Marker coordinate={pendingCoords} pinColor="#f43f5e" title="Destination" />}
        </MapView>

        {/* Floating Top UI */}
        <View style={styles.topContainer}>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher une adresse..."
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
            <Text style={styles.statusText}>{wsStatus} {pcTunnelActive && '• Tunnel PC OK'}</Text>
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

        {/* Floating Action Button (Menu) */}
        <TouchableOpacity style={styles.fab} onPress={toggleMenu}>
          <Text style={styles.fabText}>{isMenuOpen ? '✕' : '⚙️'}</Text>
        </TouchableOpacity>

        {/* Sliding Menu Overlay */}
        <Animated.View style={[styles.menuOverlay, { 
          transform: [{ translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_HEIGHT, 0] }) }]
        }]}>
          <View style={styles.menuHeader}>
            <Text style={styles.menuTitle}>Paramètres</Text>
            <TouchableOpacity onPress={toggleMenu}><Text style={styles.menuCloseText}>Fermer</Text></TouchableOpacity>
          </View>
          
          <View style={styles.menuContent}>
            {/* IP/Port Config */}
            <View style={styles.configGroup}>
              <Text style={styles.label}>Connexion PC</Text>
              <View style={styles.inputRow}>
                <TextInput 
                  style={[styles.input, { flex: 2 }]} 
                  placeholder="IP du PC (ex: 192.168.1.15)" 
                  placeholderTextColor="#475569"
                  value={serverIp} 
                  onChangeText={setServerIp} 
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
              <Text style={styles.label}>Surveillance d'arrière-plan</Text>
              <Text style={styles.hint}>Maintient la connexion active même si l'iPhone est verrouillé.</Text>
              <TouchableOpacity 
                style={[styles.button, { backgroundColor: isMaintaining ? '#f43f5e' : '#10b981', marginTop: 10 }]} 
                onPress={toggleLocationUpdates}
              >
                <Text style={styles.buttonText}>{isMaintaining ? 'ARRÊTER LE SERVICE' : 'DÉMARRER LE SERVICE'}</Text>
              </TouchableOpacity>
            </View>

            {pendingCoords && (
              <View style={styles.configGroup}>
                <Text style={styles.label}>Action Rapide</Text>
                <TouchableOpacity 
                  style={[styles.button, { backgroundColor: '#8b5cf6' }]} 
                  onPress={() => { 
                    sendLocationToPc(pendingCoords.latitude, pendingCoords.longitude); 
                    setPendingCoords(null); 
                    toggleMenu(); 
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }}
                >
                  <Text style={styles.buttonText}>🚀 TÉLÉPORTATION ICI</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
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
  { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
  { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#38414e" }] },
  { "featureType": "road", "elementType": "geometry.stroke", "stylers": [{ "color": "#212a37" }] },
  { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#9ca5b3" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#17263c" }] }
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  map: { width: '100%', height: '100%' },
  
  // Custom Marker
  userMarker: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  userMarkerPulse: { position: 'absolute', width: 30, height: 30, borderRadius: 15, backgroundColor: '#6366f1', opacity: 0.3 },
  userMarkerInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#6366f1', borderWidth: 2, borderColor: '#fff' },

  // Scanner UI
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  scannerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scannerTarget: { width: 250, height: 250, borderWidth: 2, borderColor: '#6366f1', borderRadius: 30, backgroundColor: 'transparent' },
  scannerHint: { color: '#fff', marginTop: 30, fontWeight: 'bold', fontSize: 16 },
  closeScanner: { position: 'absolute', bottom: 60, alignSelf: 'center', backgroundColor: '#6366f1', paddingHorizontal: 30, paddingVertical: 15, borderRadius: 30 },
  
  // Floating Top UI
  topContainer: { position: 'absolute', top: 60, left: 20, right: 20, zIndex: 10 },
  searchBar: { 
    flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 20, 
    paddingHorizontal: 15, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10
  },
  searchInput: { flex: 1, fontSize: 16, color: '#f8fafc', fontWeight: '500' },
  searchIconBtn: { marginLeft: 10 },

  // Status Pill
  statusContainer: { position: 'absolute', top: 130, alignSelf: 'center', zIndex: 5 },
  statusPill: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.9)', 
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderLeftWidth: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)'
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  statusText: { color: '#f8fafc', fontSize: 12, fontWeight: 'bold', letterSpacing: 0.5 },

  // Joystick
  joystickArea: { position: 'absolute', bottom: 130, right: 30, zIndex: 20 },
  joystickBase: { width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(15,23,42,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  joystickHandle: { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(255,255,255,0.1)', padding: 12 },
  joystickInner: { flex: 1, borderRadius: 21, backgroundColor: '#6366f1', shadowColor: '#6366f1', shadowOpacity: 0.6, shadowRadius: 10, elevation: 5 },

  // FAB
  fab: { 
    position: 'absolute', bottom: 45, right: 30, width: 64, height: 64, 
    borderRadius: 32, backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366f1', shadowOpacity: 0.5, shadowRadius: 15, elevation: 12
  },
  fabText: { fontSize: 26, color: '#fff' },

  // Menu Overlay
  menuOverlay: { 
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
    backgroundColor: '#0f172a', zIndex: 100, padding: 30, paddingTop: 70 
  },
  menuHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 },
  menuTitle: { fontSize: 32, fontWeight: 'bold', color: '#f8fafc' },
  menuCloseText: { color: '#6366f1', fontWeight: 'bold', fontSize: 16 },
  menuContent: { flex: 1 },
  
  configGroup: { marginBottom: 35 },
  label: { color: '#6366f1', fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 1.5 },
  hint: { color: '#64748b', fontSize: 13, marginBottom: 5 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  input: { flex: 1, backgroundColor: '#1e293b', color: '#f8fafc', padding: 18, borderRadius: 15, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  qrBtn: { marginLeft: 12, padding: 15, backgroundColor: '#1e293b', borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  button: { padding: 20, borderRadius: 18, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15, letterSpacing: 0.5 },
  btnText: { color: '#fff', fontWeight: 'bold' }
});
