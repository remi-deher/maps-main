import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Button, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import MapView, { Marker } from 'react-native-maps';

const LOCATION_TASK_NAME = 'background-location-task';
const DEFAULT_PORT = '8080';

// On utilise un bus d'événement global pour communiquer entre la tâche de fond et l'UI/WS
const eventBus = {
  listeners: [],
  subscribe(cb) { this.listeners.push(cb) },
  emit(data) { this.listeners.forEach(cb => cb(data)) }
};

TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
  if (error) return;
  if (data) {
    eventBus.emit({ type: 'TICK' });
  }
});

export default function App() {
  const [isMaintaining, setIsMaintaining] = useState(false);
  const [serverIp, setServerIp] = useState('');
  const [serverPort, setServerPort] = useState(DEFAULT_PORT);
  const [wsStatus, setWsStatus] = useState('Déconnecté');
  const [pcTunnelActive, setPcTunnelActive] = useState(false);
  const [simulatedCoords, setSimulatedCoords] = useState(null);
  const [pendingCoords, setPendingCoords] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  
  const ws = useRef(null);
  const reconnectTimer = useRef(null);
  const isConnecting = useRef(false);

  useEffect(() => {
    (async () => {
      let { status: foreground } = await Location.requestForegroundPermissionsAsync();
      if (foreground !== 'granted') {
        setErrorMsg('Permission de localisation refusée');
      }
    })();

    // S'abonner aux ticks de la tâche de fond
    const unsubscribe = eventBus.subscribe(() => {
      if (isMaintaining) sendHeartbeat(true);
    });

    return () => {
      unsubscribe();
      stopWs();
      if (reconnectTimer.current) clearInterval(reconnectTimer.current);
    };
  }, [isMaintaining]);

  // Gérer la reconnexion automatique
  useEffect(() => {
    if (serverIp && wsStatus === 'Déconnecté' && !isConnecting.current) {
      reconnectTimer.current = setTimeout(() => {
        connectWs();
      }, 5000);
    } else if (wsStatus === 'Connecté' && reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
    }
    return () => clearTimeout(reconnectTimer.current);
  }, [serverIp, wsStatus]);

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
            setPendingCoords(null); // Réinitialiser si une nouvelle position arrive du PC
            Alert.alert("Succès", "Position mise à jour sur le PC");
          }
        } catch (err) {
          console.log('WS JSON Error', err);
        }
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

  const stopWs = () => {
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
  };

  const sendHeartbeat = (maintaining) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'HEARTBEAT',
        data: { isMaintaining: maintaining }
      }));
    }
  };

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
        setErrorMsg('Autorisez "Toujours" la localisation dans les réglages iOS');
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

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.title}>📍 GPS Mock Companion</Text>
        <View style={[styles.badge, { backgroundColor: wsStatus === 'Connecté' ? '#E8F5E9' : '#FFF3E0' }]}>
          <View style={[styles.dot, { backgroundColor: wsStatus === 'Connecté' ? '#4CAF50' : '#FF9800' }]} />
          <Text style={[styles.badgeText, { color: wsStatus === 'Connecté' ? '#2E7D32' : '#E65100' }]}>
            {wsStatus}
          </Text>
        </View>
      </View>
      
      <View style={styles.mainGrid}>
        <View style={styles.statusCard}>
          <Text style={styles.cardLabel}>Tunnel PC</Text>
          <Text style={[styles.cardValue, { color: pcTunnelActive ? '#4CAF50' : '#9E9E9E' }]}>
            {pcTunnelActive ? 'PRÊT' : 'INACTIF'}
          </Text>
          <View style={[styles.cardIndicator, { backgroundColor: pcTunnelActive ? '#4CAF50' : '#E0E0E0' }]} />
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.cardLabel}>Maintenance</Text>
          <Text style={[styles.cardValue, { color: isMaintaining ? '#2196F3' : '#9E9E9E' }]}>
            {isMaintaining ? 'ACTIVE' : 'OFF'}
          </Text>
          <View style={[styles.cardIndicator, { backgroundColor: isMaintaining ? '#2196F3' : '#E0E0E0' }]} />
        </View>
      </View>

      {simulatedCoords ? (
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            region={{
              latitude: simulatedCoords.lat,
              longitude: simulatedCoords.lon,
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
                title="Nouveau point choisi"
                pinColor="red"
              />
            )}
          </MapView>
          <View style={styles.mapOverlay}>
            <Text style={styles.mapCoords}>
              {simulatedCoords.lat.toFixed(6)}, {simulatedCoords.lon.toFixed(6)}
            </Text>
            {simulatedCoords.name && <Text style={styles.mapPlace}>{simulatedCoords.name}</Text>}
          </View>
        </View>
      ) : (
        <View style={styles.emptyMapContainer}>
          <MapView
            style={styles.map}
            onLongPress={onMapLongPress}
            initialRegion={{
              latitude: 48.8566,
              longitude: 2.3522,
              latitudeDelta: 0.1,
              longitudeDelta: 0.1,
            }}
          >
            {pendingCoords && (
              <Marker
                coordinate={pendingCoords}
                title="Nouveau point choisi"
                pinColor="red"
              />
            )}
          </MapView>
          <View style={styles.emptyMapOverlay}>
             <Text style={styles.emptyMapText}>Faites un appui long pour choisir un point</Text>
          </View>
        </View>
      )}

      {pendingCoords && (
        <View style={styles.applyBox}>
          <Button title="🚀 Appliquer cette position" onPress={applyPendingLocation} color="#4CAF50" />
          <Button title="Annuler" onPress={() => setPendingCoords(null)} color="#666" />
        </View>
      )}

      <View style={styles.configBox}>
        <Text style={styles.configTitle}>Connexion au Serveur</Text>
        <View style={styles.inputRow}>
          <View style={{ flex: 3, marginRight: 10 }}>
            <Text style={styles.inputLabel}>Adresse IP</Text>
            <TextInput
              style={styles.input}
              placeholder="192.168.1.15"
              value={serverIp}
              onChangeText={setServerIp}
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.inputLabel}>Port</Text>
            <TextInput
              style={styles.input}
              placeholder="8080"
              value={serverPort}
              onChangeText={setServerPort}
              keyboardType="numeric"
            />
          </View>
        </View>
        <Button title="Connecter" onPress={connectWs} disabled={!serverIp || wsStatus === 'Connecté'} />
      </View>

      <View style={styles.actionArea}>
        <Button
          title={isMaintaining ? "Désactiver la Surveillance" : "Activer la Surveillance"}
          onPress={toggleLocationUpdates}
          color={isMaintaining ? "#F44336" : "#2196F3"}
        />
        <Text style={styles.hint}>
          Garde l'application ouverte ou en arrière-plan pour maintenir le tunnel actif.
        </Text>
      </View>

      {errorMsg && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
    padding: 20,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A202C',
    marginBottom: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  mainGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statusCard: {
    backgroundColor: '#FFF',
    width: '48%',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  cardLabel: {
    fontSize: 12,
    color: '#718096',
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  cardValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  cardIndicator: {
    width: '100%',
    height: 4,
    borderRadius: 2,
  },
  mapContainer: {
    height: 180,
    backgroundColor: '#FFF',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  mapOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 8,
    alignItems: 'center',
  },
  mapCoords: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  mapPlace: {
    fontSize: 10,
    color: '#718096',
  },
  emptyMapContainer: {
    height: 180,
    backgroundColor: '#EDF2F7',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  emptyMapOverlay: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  emptyMapText: {
    color: '#FFF',
    fontSize: 12,
  },
  applyBox: {
    backgroundColor: '#FFF',
    padding: 15,
    borderRadius: 16,
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-around',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  configBox: {
    backgroundColor: '#FFF',
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  configTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: 15,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  inputLabel: {
    fontSize: 12,
    color: '#A0AEC0',
    marginBottom: 5,
  },
  input: {
    backgroundColor: '#EDF2F7',
    padding: 12,
    borderRadius: 10,
    fontSize: 16,
    color: '#2D3748',
  },
  actionArea: {
    marginTop: 10,
  },
  hint: {
    fontSize: 12,
    color: '#A0AEC0',
    textAlign: 'center',
    marginTop: 15,
    paddingHorizontal: 20,
  },
  errorBox: {
    backgroundColor: '#FFF5F5',
    padding: 15,
    borderRadius: 12,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#FEB2B2',
  },
  errorText: {
    color: '#C53030',
    fontSize: 14,
    textAlign: 'center',
  },
});
