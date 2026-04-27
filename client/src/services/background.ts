import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LOCATION_TASK_NAME = 'background-location-task';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.error(`[task] Erreur: ${error.message}`);
    return;
  }

  if (data) {
    const { locations } = data;
    const location = locations[0];
    if (location) {
      const { latitude, longitude } = location.coords;
      
      try {
        const ip = await AsyncStorage.getItem('serverIp');
        const port = await AsyncStorage.getItem('serverPort');
        
        if (ip && port) {
          // Envoi de la position actuelle au serveur pour le Watchdog (Relance)
          await fetch(`http://${ip}:${port}/api/relance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              lat: latitude, 
              lon: longitude,
              timestamp: Date.now()
            })
          });
        }
      } catch (e) {
        // Silencieux en tâche de fond
      }
    }
  }
});
