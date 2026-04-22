import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Button } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const LOCATION_TASK_NAME = 'background-location-task';

// 1. Définition de la tâche de fond
// Cette tâche est appelée par le système même si l'application est fermée ou verrouillée.
TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
  if (error) {
    console.error(error);
    return;
  }
  if (data) {
    const { locations } = data;
    // On ne fait rien de spécial des coordonnées, le simple fait de recevoir 
    // l'update maintient la puce GPS (et donc le tunnel DVT) en éveil.
    console.log('Background location update received');
  }
});

export default function App() {
  const [isMaintaining, setIsMaintaining] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission de localisation refusée');
        return;
      }
    })();
  }, []);

  const toggleLocationUpdates = async () => {
    if (isMaintaining) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      setIsMaintaining(false);
    } else {
      // Vérification des permissions de premier plan
      const { status: foregroundStatus } = await Location.getForegroundPermissionsAsync();
      if (foregroundStatus !== 'granted') return;

      // Demande des permissions d'arrière-plan (Nécessaire pour le verrouillage)
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        setErrorMsg('Permission d\'arrière-plan refusée');
        return;
      }

      // Démarrage du tracking
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1,
        // Options spécifiques iOS pour le background
        pausesLocationUpdatesAutomatically: false,
        allowsBackgroundLocationUpdates: true,
        showsBackgroundLocationIndicator: true,
      });
      setIsMaintaining(true);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📍 GPS Mock Companion</Text>
      
      <View style={styles.card}>
        <Text style={styles.statusLabel}>Statut :</Text>
        <Text style={[styles.statusValue, { color: isMaintaining ? '#4CAF50' : '#F44336' }]}>
          {isMaintaining ? 'MAINTENANCE ACTIVE' : 'INACTIF'}
        </Text>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          Cette application force l'iPhone à maintenir les services de localisation actifs, 
          empêchant ainsi iOS de fermer le tunnel de simulation quand l'écran s'éteint.
        </Text>
      </View>

      <View style={styles.buttonContainer}>
        <Button
          title={isMaintaining ? "Arrêter la Maintenance" : "Démarrer la Maintenance"}
          onPress={toggleLocationUpdates}
          color={isMaintaining ? "#F44336" : "#2196F3"}
        />
      </View>

      {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}
    </View>
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
    marginBottom: 40,
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 15,
    width: '100%',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusLabel: {
    fontSize: 18,
    marginRight: 10,
  },
  statusValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  infoBox: {
    padding: 20,
    marginBottom: 40,
    backgroundColor: '#e7f3ff',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#b2d7ff',
  },
  infoText: {
    color: '#0056b3',
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonContainer: {
    width: '100%',
    height: 50,
  },
  error: {
    color: '#d32f2f',
    marginTop: 20,
    fontWeight: '500',
  },
});
