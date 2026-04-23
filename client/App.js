import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, TextInput, KeyboardAvoidingView, 
  Platform, Alert, Animated, Dimensions, TouchableOpacity, ActivityIndicator,
  TouchableWithoutFeedback, Keyboard, ScrollView, SafeAreaView
} from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { CameraView, useCameraPermissions } from 'expo-camera';
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

import * as TaskManager from 'expo-task-manager';

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
  const [simulatedCoords, setSimulatedCoords] = useState(null);
  const [pendingCoords, setPendingCoords] = useState(null);
  
  // États de données (Server side is truth)
  const [favorites, setFavorites] = useState([]);

  // États Recherche & Scanner
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [showScanner, setShowScanner] = useState(false);

  // États UI
  const [isFavsOpen, setIsFavsOpen] = useState(false);
  const favsAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef(null);
  const ws = useRef(null);
  const isConnecting = useRef(false);

  // ─── Initialisation ──────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      await Location.requestForegroundPermissionsAsync();
      requestCameraPermission();

      // Charger l'IP du PC sauvegardée
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
    };
  }, [isMaintaining]);

  // Tentative de connexion auto
  useEffect(() => {
    if (serverIp && wsStatus === 'Déconnecté' && !isConnecting.current) {
      connectWs();
    }
  }, [serverIp]);

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
        sendHeartbeat(isMaintaining);
        AsyncStorage.setItem('serverIp', serverIp);
        AsyncStorage.setItem('serverPort', serverPort);
      };
      ws.current.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'STATUS') {
            // Mise à jour des favoris depuis le serveur (Source de vérité)
            if (payload.data.favorites) {
              setFavorites(payload.data.favorites);
            }
          } else if (payload.type === 'LOCATION') {
            const nextCoords = { latitude: payload.data.lat, longitude: payload.data.lon, name: payload.data.name };
            setSimulatedCoords(nextCoords);
            mapRef.current?.animateToRegion({ ...nextCoords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
          }
        } catch (err) { }
      };
      ws.current.onclose = () => {
        isConnecting.current = false;
        setWsStatus('Déconnecté');
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

  const sendAction = (type, data) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, data }));
    }
  };

  // ─── Actions ────────────────────────────────────────────────────────────────

  const teleportTo = (coords) => {
    sendAction('SET_LOCATION', { lat: coords.latitude, lon: coords.longitude, name: coords.name || "" });
    setPendingCoords(null);
    if (isFavsOpen) toggleFavs();
  };

  const addFavorite = (coords) => {
    const name = coords.name || `Favori ${favorites.length + 1}`;
    sendAction('ADD_FAVORITE', { lat: coords.latitude, lon: coords.longitude, name });
  };

  const removeFavorite = (fav) => {
    sendAction('REMOVE_FAVORITE', { lat: fav.lat, lon: fav.lon });
  };

  const handleBarCodeScanned = ({ data }) => {
    setShowScanner(false);
    try {
      if (data.startsWith('{')) {
        const config = JSON.parse(data);
        if (config.ip) { setServerIp(config.ip); setServerPort(config.port || DEFAULT_PORT); return; }
      }
      const match = data.match(/ws:\/\/([^:]+):(\d+)/);
      if (match) { setServerIp(match[1]); setServerPort(match[2]); }
      else { setServerIp(data); }
    } catch (e) { Alert.alert("Erreur", "QR Code invalide."); }
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    setIsSearching(true);
    try {
      const results = await Location.geocodeAsync(searchQuery);
      if (results.length > 0) {
        const newCoords = { latitude: results[0].latitude, longitude: results[0].longitude, name: searchQuery };
        setPendingCoords(newCoords);
        mapRef.current?.animateToRegion({ ...newCoords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
      }
    } catch (e) { Alert.alert("Erreur", "Lieu introuvable."); }
    finally { setIsSearching(false); Keyboard.dismiss(); }
  };

  const toggleFavs = () => {
    const toValue = isFavsOpen ? 0 : 1;
    Animated.spring(favsAnim, { toValue, useNativeDriver: false, friction: 8 }).start();
    setIsFavsOpen(!isFavsOpen);
  };

  const toggleLocationUpdates = async () => {
    if (isMaintaining) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      setIsMaintaining(false);
      sendHeartbeat(false);
    } else {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission", "La permission de localisation en arrière-plan est requise pour maintenir la connexion.");
        return;
      }
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 1,
        deferredUpdatesInterval: 5000,
        foregroundService: { notificationTitle: "GPS Mock", notificationBody: "Service de maintien actif", notificationColor: "#6366f1" }
      });
      setIsMaintaining(true);
      sendHeartbeat(true);
    }
  };

  const isPosFavorite = (lat, lon) => favorites.some(f => Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001);

  // ─── Rendu ──────────────────────────────────────────────────────────────────

  if (showScanner) {
    return (
      <View style={styles.scannerContainer}>
        <CameraView onBarcodeScanned={handleBarCodeScanned} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} style={StyleSheet.absoluteFillObject} />
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
             setPendingCoords({ ...e.nativeEvent.coordinate, name: "Position sélectionnée" });
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

        {/* Top Search Bar & Connection Status */}
        <SafeAreaView style={styles.topContainer}>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher une adresse..."
              placeholderTextColor="#64748b"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
            />
            <TouchableOpacity onPress={() => setShowScanner(true)} style={styles.iconBtn}>
              <Text style={{fontSize: 20}}>📷</Text>
            </TouchableOpacity>
          </View>
          
          <View style={[styles.statusPill, { borderLeftColor: wsStatus === 'Connecté' ? '#10b981' : '#f43f5e' }]}>
            <View style={[styles.dot, { backgroundColor: wsStatus === 'Connecté' ? '#10b981' : '#f43f5e' }]} />
            <Text style={styles.statusText}>{wsStatus} {isMaintaining && '• ACTIF'}</Text>
          </View>
        </SafeAreaView>

        {/* Maintain Connection Toggle (Floating Right) */}
        <TouchableOpacity 
          style={[styles.maintainBtn, isMaintaining && styles.maintainBtnActive]} 
          onPress={toggleLocationUpdates}
        >
          <Text style={{fontSize: 20}}>{isMaintaining ? '🛡️' : '💤'}</Text>
        </TouchableOpacity>

        {/* Action Panel (Bottom Center) */}
        {pendingCoords && (
          <View style={styles.actionPanel}>
            <View style={styles.actionHeader}>
              <Text style={styles.locationTitle}>{pendingCoords.name}</Text>
              <TouchableOpacity onPress={() => toggleFavorite({ lat: pendingCoords.latitude, lon: pendingCoords.longitude, name: pendingCoords.name })}>
                 <Text style={{fontSize: 24}}>{isPosFavorite(pendingCoords.latitude, pendingCoords.longitude) ? '⭐' : '☆'}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.teleportBtn} onPress={() => teleportTo(pendingCoords)}>
              <Text style={styles.teleportText}>TÉLÉPORTATION ICI 🚀</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Favorites Trigger (Bottom Right) */}
        <TouchableOpacity style={styles.favFab} onPress={toggleFavs}>
          <Text style={{fontSize: 24}}>⭐</Text>
        </TouchableOpacity>

        {/* Favorites Sliding Panel */}
        <Animated.View style={[styles.favOverlay, { 
          transform: [{ translateY: favsAnim.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_HEIGHT, 0] }) }]
        }]}>
          <SafeAreaView style={styles.favHeader}>
            <Text style={styles.favTitle}>Mes Favoris</Text>
            <TouchableOpacity onPress={toggleFavs}><Text style={styles.closeText}>Fermer</Text></TouchableOpacity>
          </SafeAreaView>
          <ScrollView style={styles.favList} showsVerticalScrollIndicator={false}>
            {favorites.length > 0 ? favorites.map((fav, i) => (
              <View key={i} style={styles.favItem}>
                <TouchableOpacity style={styles.favItemContent} onPress={() => teleportTo({ latitude: fav.lat, longitude: fav.lon, name: fav.name })}>
                  <Text style={styles.favItemName}>{fav.name}</Text>
                  <Text style={styles.favItemCoords}>{fav.lat.toFixed(4)}, {fav.lon.toFixed(4)}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeFavorite(fav)}>
                  <Text style={{fontSize: 18, color: '#f43f5e'}}>🗑️</Text>
                </TouchableOpacity>
              </View>
            )) : <Text style={styles.emptyText}>Aucun favori synchronisé.</Text>}
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
  
  topContainer: { position: 'absolute', top: 0, left: 20, right: 20, zIndex: 10, alignItems: 'center' },
  searchBar: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 12, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 },
  searchInput: { flex: 1, fontSize: 16, color: '#1e293b' },
  iconBtn: { marginLeft: 10 },
  
  statusPill: { marginTop: 15, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.8)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderLeftWidth: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 8 },
  statusText: { color: '#fff', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' },

  maintainBtn: { position: 'absolute', top: 120, right: 20, width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(15,23,42,0.8)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  maintainBtnActive: { borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.2)' },

  actionPanel: { position: 'absolute', bottom: 40, left: 20, right: 90, backgroundColor: '#1e293b', borderRadius: 25, padding: 20, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 15 },
  actionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  locationTitle: { color: '#fff', fontWeight: 'bold', fontSize: 16, flex: 1 },
  teleportBtn: { backgroundColor: '#6366f1', padding: 15, borderRadius: 15, alignItems: 'center' },
  teleportText: { color: '#fff', fontWeight: 'bold' },

  favFab: { position: 'absolute', bottom: 40, right: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 },
  favOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0f172a', zIndex: 100, padding: 25 },
  favHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  favTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  closeText: { color: '#6366f1', fontWeight: 'bold' },
  favList: { flex: 1 },
  favItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', padding: 18, borderRadius: 20, marginBottom: 12 },
  favItemContent: { flex: 1 },
  favItemName: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  favItemCoords: { color: '#64748b', fontSize: 12 },
  emptyText: { color: '#475569', textAlign: 'center', marginTop: 40 },
  btnText: { color: '#fff', fontWeight: 'bold' }
});
