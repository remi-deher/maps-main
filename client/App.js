import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Button, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

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
  const [wsStatus, setWsStatus] = useState('Déconnecté');
  const [errorMsg, setErrorMsg] = useState(null);
  
  const ws = useRef(null);
  const heartbeatTimer = useRef(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission de localisation refusée');
      }
    })();

    // S'abonner aux ticks de la tâche de fond pour envoyer des heartbeats même si l'UI est réduite
    eventBus.subscribe(() => {
      if (isMaintaining) sendHeartbeat(true);
    });

    return () => stopWs();
  }, []);

  const connectWs = () => {
    stopWs();
    if (!serverIp) return;

    setWsStatus('Connexion...');
    try {
      ws.current = new WebSocket(`ws://${serverIp}:${DEFAULT_PORT}`);
      
      ws.current.onopen = () => {
        setWsStatus('Connecté');
        sendHeartbeat(isMaintaining);
      };
      
      ws.current.onclose = () => setWsStatus('Déconnecté');
      ws.current.onerror = () => setWsStatus('Erreur');
      
    } catch (e) {
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
        setErrorMsg('Permission d\'arrière-plan refusée');
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

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <Text style={styles.title}>📍 GPS Mock Companion</Text>
      
      <View style={styles.card}>
        <Text style={styles.statusLabel}>Statut PC :</Text>
        <Text style={[styles.statusValue, { color: wsStatus === 'Connecté' ? '#4CAF50' : '#FF9800' }]}>
          {wsStatus}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.statusLabel}>Maintenance :</Text>
        <Text style={[styles.statusValue, { color: isMaintaining ? '#4CAF50' : '#F44336' }]}>
          {isMaintaining ? 'ACTIVE' : 'INACTIVE'}
        </Text>
      </View>

      <View style={styles.inputBox}>
        <Text style={styles.inputLabel}>IP du PC (affichée sur le serveur) :</Text>
        <TextInput
          style={styles.input}
          placeholder="ex: 192.168.1.15"
          value={serverIp}
          onChangeText={setServerIp}
          keyboardType="numeric"
        />
        <Button title="Connecter au PC" onPress={connectWs} disabled={!serverIp} />
      </View>

      <View style={styles.buttonContainer}>
        <Button
          title={isMaintaining ? "Arrêter la Maintenance" : "Démarrer la Maintenance"}
          onPress={toggleLocationUpdates}
          color={isMaintaining ? "#F44336" : "#2196F3"}
        />
      </View>

      {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    width: '100%',
    elevation: 2,
  },
  statusLabel: {
    fontSize: 16,
    marginRight: 10,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  inputBox: {
    width: '100%',
    padding: 15,
    backgroundColor: '#f0f4f8',
    borderRadius: 12,
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    marginBottom: 8,
    color: '#666',
  },
  input: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  buttonContainer: {
    width: '100%',
    marginTop: 10,
  },
  error: {
    color: '#d32f2f',
    marginTop: 20,
    textAlign: 'center',
  },
});
