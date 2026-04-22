import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, Button, TextInput, KeyboardAvoidingView, 
  Platform, Alert, Animated, PanResponder, Dimensions, TouchableOpacity, ActivityIndicator 
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import MapView, { Marker } from 'react-native-maps';
import { BarCodeScanner } from 'expo-barcode-scanner';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
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
  const [errorMsg, setErrorMsg] = useState(null);

  // États Recherche & Scanner
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(null);
  const [showScanner, setShowScanner] = useState(false);

  // États UI (Bottom Sheet)
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetY = useRef(new Animated.Value(SCREEN_HEIGHT * 0.75)).current;
  const mapRef = useRef(null);
  const ws = useRef(null);
  const reconnectTimer = useRef(null);
  const isConnecting = useRef(false);

  // ─── Initialisation & Permissions ───────────────────────────────────────────

  useEffect(() => {
    (async () => {
      let { status: foreground } = await Location.requestForegroundPermissionsAsync();
      if (foreground !== 'granted') setErrorMsg('Permission de localisation refusée');
      
      const { status: cam } = await BarCodeScanner.requestPermissionsAsync();
      setHasCameraPermission(cam === 'granted');
    })();

    const unsubscribe = eventBus.subscribe(() => {
      if (isMaintaining) sendHeartbeat(true);
    });

    return () => {
      unsubscribe();
      stopWs();
      if (reconnectTimer.current) clearInterval(reconnectTimer.current);
    };
  }, [isMaintaining]);

  useEffect(() => {
    if (serverIp && wsStatus === 'Déconnecté' && !isConnecting.current) {
      reconnectTimer.current = setTimeout(() => connectWs(), 5000);
    } else if (wsStatus === 'Connecté' && reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
    }
    return () => clearTimeout(reconnectTimer.current);
  }, [serverIp, wsStatus]);

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
        sendHeartbeat(isMaintaining);
      };
      ws.current.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'STATUS') {
            setPcTunnelActive(payload.data.tunnelActive);
          } else if (payload.type === 'LOCATION') {
            setSimulatedCoords(payload.data);
            setPendingCoords(null);
            Alert.alert("📍 Simulation Active", `Position mise à jour sur le PC`);
            // Centrer la carte sur la nouvelle position
            mapRef.current?.animateToRegion({
              latitude: payload.data.lat,
              longitude: payload.data.lon,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }, 1000);
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

  // ─── Actions Simulation ─────────────────────────────────────────────────────

  const toggleLocationUpdates = async () => {
    if (isMaintaining) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      setIsMaintaining(false);
      sendHeartbeat(false);
    } else {
      const { status: foregroundStatus } = await Location.getForegroundPermissionsAsync();
      if (foregroundStatus !== 'granted') return;
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        Alert.alert("Permission Requise", "Autorisez l'accès 'Toujours' pour la maintenance.");
        return;
      }
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 1,
        pausesLocationUpdatesAutomatically: false,
        allowsBackgroundLocationUpdates: true,
        showsBackgroundLocationIndicator: true,
      });
      setIsMaintaining(true);
      sendHeartbeat(true);
    }
  };

  const onMapLongPress = (e) => {
    const coords = e.nativeEvent.coordinate;
    setPendingCoords(coords);
    if (!sheetOpen) toggleSheet();
  };

  const applyPendingLocation = () => {
    if (ws.current?.readyState === WebSocket.OPEN && pendingCoords) {
      ws.current.send(JSON.stringify({
        type: 'SET_LOCATION',
        data: { lat: pendingCoords.latitude, lon: pendingCoords.longitude }
      }));
    } else {
      Alert.alert("Erreur", "Vérifiez votre connexion au PC");
    }
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    setIsSearching(true);
    try {
      const results = await Location.geocodeAsync(searchQuery);
      if (results.length > 0) {
        const { latitude, longitude } = results[0];
        const newCoords = { latitude, longitude };
        setPendingCoords(newCoords);
        mapRef.current?.animateToRegion({
          ...newCoords,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1000);
        if (!sheetOpen) toggleSheet();
      } else {
        Alert.alert("Non trouvé", "Adresse inconnue.");
      }
    } catch (e) { Alert.alert("Erreur", "Problème lors de la recherche."); }
    finally { setIsSearching(false); }
  };

  const handleBarCodeScanned = ({ data }) => {
    setShowScanner(false);
    try {
      // Format attendu: ws://IP:PORT
      const url = new URL(data);
      if (url.protocol === 'ws:') {
        setServerIp(url.hostname);
        setServerPort(url.port || DEFAULT_PORT);
        Alert.alert("QR Code Scanné", `Serveur détecté : ${url.hostname}`);
      }
    } catch (e) { Alert.alert("Erreur", "QR Code invalide."); }
  };

  // ─── Animation Bottom Sheet ─────────────────────────────────────────────────

  const toggleSheet = () => {
    const toValue = sheetOpen ? SCREEN_HEIGHT * 0.75 : SCREEN_HEIGHT * 0.35;
    Animated.spring(sheetY, {
      toValue,
      useNativeDriver: false,
      friction: 8
    }).start();
    setSheetOpen(!sheetOpen);
  };

  // ─── Rendu ──────────────────────────────────────────────────────────────────

  if (showScanner) {
    return (
      <View style={styles.scannerContainer}>
        <BarCodeScanner
          onBarCodeScanned={handleBarCodeScanned}
          style={StyleSheet.absoluteFillObject}
        />
        <TouchableOpacity style={styles.closeScanner} onPress={() => setShowScanner(false)}>
          <Text style={styles.closeScannerText}>Annuler</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 1. Carte Full Screen */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: simulatedCoords?.lat || 48.8566,
          longitude: simulatedCoords?.lon || 2.3522,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        onLongPress={onMapLongPress}
      >
        {simulatedCoords && (
          <Marker
            coordinate={{ latitude: simulatedCoords.lat, longitude: simulatedCoords.lon }}
            title="Simulation Active"
            pinColor="blue"
          />
        )}
        {pendingCoords && (
          <Marker
            coordinate={pendingCoords}
            title="Point choisi"
            pinColor="red"
          />
        )}
      </MapView>

      {/* 2. Barre de Recherche Flottante */}
      <KeyboardAvoidingView behavior="position" style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher une adresse..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
          />
          <TouchableOpacity onPress={handleSearch} disabled={isSearching}>
            {isSearching ? <ActivityIndicator size="small" color="#2196F3" /> : <Text style={styles.searchIcon}>🔍</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* 3. Bottom Sheet Coulissant */}
      <Animated.View style={[styles.bottomSheet, { top: sheetY }]}>
        <TouchableOpacity style={styles.sheetHandleArea} onPress={toggleSheet}>
          <View style={styles.sheetHandle} />
        </TouchableOpacity>

        <View style={styles.sheetContent}>
          {/* Section Statut */}
          <View style={styles.statusRow}>
            <View style={[styles.badge, { backgroundColor: wsStatus === 'Connecté' ? '#E8F5E9' : '#FFF3E0' }]}>
              <View style={[styles.dot, { backgroundColor: wsStatus === 'Connecté' ? '#4CAF50' : '#FF9800' }]} />
              <Text style={[styles.badgeText, { color: wsStatus === 'Connecté' ? '#2E7D32' : '#E65100' }]}>{wsStatus}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: pcTunnelActive ? '#E3F2FD' : '#F5F5F5' }]}>
              <Text style={[styles.badgeText, { color: pcTunnelActive ? '#1976D2' : '#9E9E9E' }]}>Tunnel PC: {pcTunnelActive ? 'PRÊT' : 'OFF'}</Text>
            </View>
          </View>

          {/* Section Pending (Si point choisi) */}
          {pendingCoords && (
            <View style={styles.pendingArea}>
              <Text style={styles.pendingText}>📍 Position sélectionnée</Text>
              <View style={styles.pendingButtons}>
                <TouchableOpacity style={[styles.actionBtn, styles.applyBtn]} onPress={applyPendingLocation}>
                  <Text style={styles.btnText}>🚀 Appliquer</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.cancelBtn]} onPress={() => setPendingCoords(null)}>
                  <Text style={styles.btnText}>Annuler</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Section Maintenance */}
          <TouchableOpacity 
            style={[styles.maintenanceBtn, { backgroundColor: isMaintaining ? '#F44336' : '#2196F3' }]} 
            onPress={toggleLocationUpdates}
          >
            <Text style={styles.btnText}>{isMaintaining ? "Désactiver la Surveillance" : "Activer la Surveillance"}</Text>
          </TouchableOpacity>

          {/* Section Config */}
          <View style={styles.configArea}>
            <Text style={styles.configLabel}>Configuration Serveur</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.configInput, { flex: 3 }]}
                placeholder="IP PC (ex: 192.168.1.15)"
                value={serverIp}
                onChangeText={setServerIp}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.configInput, { flex: 1, marginLeft: 8 }]}
                placeholder="Port"
                value={serverPort}
                onChangeText={setServerPort}
                keyboardType="numeric"
              />
              <TouchableOpacity style={styles.scanBtn} onPress={() => setShowScanner(true)}>
                <Text style={{ fontSize: 20 }}>📷</Text>
              </TouchableOpacity>
            </View>
            <Button title="Connecter" onPress={connectWs} disabled={!serverIp || wsStatus === 'Connecté'} />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  map: { width: '100%', height: '100%' },
  
  // Scanner
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  closeScanner: { position: 'absolute', bottom: 50, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.8)', padding: 15, borderRadius: 30 },
  closeScannerText: { fontWeight: 'bold', color: '#000' },

  // Recherche
  searchContainer: { position: 'absolute', top: 50, left: 20, right: 20, zIndex: 10 },
  searchBar: { 
    flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 25, 
    paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 5
  },
  searchInput: { flex: 1, fontSize: 16, color: '#2D3748' },
  searchIcon: { fontSize: 18 },

  // Bottom Sheet
  bottomSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#FFF', borderTopLeftRadius: 25, borderTopRightRadius: 25,
    shadowColor: '#000', shadowOffset: { width: 0, height: -5 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 20
  },
  sheetHandleArea: { width: '100%', height: 30, alignItems: 'center', justifyContent: 'center' },
  sheetHandle: { width: 40, height: 5, backgroundColor: '#E2E8F0', borderRadius: 3 },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 40 },

  statusRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  badgeText: { fontSize: 13, fontWeight: '700' },

  pendingArea: { backgroundColor: '#F0FFF4', padding: 15, borderRadius: 15, marginBottom: 20, borderWeight: 1, borderColor: '#C6F6D5' },
  pendingText: { fontSize: 14, fontWeight: 'bold', color: '#2F855A', marginBottom: 10, textAlign: 'center' },
  pendingButtons: { flexDirection: 'row', justifyContent: 'space-around' },
  actionBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, flex: 0.45, alignItems: 'center' },
  applyBtn: { backgroundColor: '#48BB78' },
  cancelBtn: { backgroundColor: '#EDF2F7' },
  btnText: { color: '#FFF', fontWeight: 'bold' },

  maintenanceBtn: { padding: 15, borderRadius: 15, alignItems: 'center', marginBottom: 20 },
  
  configArea: { backgroundColor: '#F7FAFC', padding: 15, borderRadius: 15 },
  configLabel: { fontSize: 12, fontWeight: '700', color: '#718096', marginBottom: 10, textTransform: 'uppercase' },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  configInput: { backgroundColor: '#FFF', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  scanBtn: { marginLeft: 10, padding: 8, backgroundColor: '#FFF', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0' }
});
