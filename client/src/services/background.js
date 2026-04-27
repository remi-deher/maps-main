import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LOCATION_TASK_NAME = 'background-location-task';

// Bus d'événement global pour la communication UI (quand l'app est ouverte)
export const eventBus = {
  listeners: [],
  subscribe(cb) { 
    this.listeners.push(cb); 
    return () => { this.listeners = this.listeners.filter(l => l !== cb); } 
  },
  emit(data) { 
    this.listeners.forEach(cb => cb(data)); 
  }
};

/**
 * Calcule la distance entre deux points GPS (en mètres)
 */
const getDistance = (c1, c2) => {
  const R = 6371000;
  const dLat = (c2.latitude - c1.latitude) * Math.PI / 180;
  const dLon = (c2.longitude - c1.longitude) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(c1.latitude * Math.PI/180) * 
            Math.cos(c2.latitude * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

// Verrou mémoire pour éviter les rafales dues à l'asynchronisme d'AsyncStorage
let isRelanceInProgress = false;

// Définition de la tâche de fond
if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error || isRelanceInProgress) return;
    
    if (data && data.locations && data.locations.length > 0) {
      const currentLoc = data.locations[0].coords;
      
      try {
        // 1. Récupérer la cible simulée stockée par l'UI
        const mockJson = await AsyncStorage.getItem('MOCK_LOCATION');
        if (!mockJson) return;
        const mockCoords = JSON.parse(mockJson);
        
        // 2. Calculer la distance (Détection de dérive)
        const dist = getDistance(currentLoc, mockCoords);
        
        // 3. Si dérive > 200m, la simulation est probablement tombée
        // On ignore les dérives délirantes (ex: 0,0 ou GPS non fixé)
        if (dist > 200 && dist < 20000000) {
           const now = Date.now();
           let firstDriftTime = await AsyncStorage.getItem('FIRST_DRIFT_TIME');
           
           if (!firstDriftTime) {
             firstDriftTime = now.toString();
             await AsyncStorage.setItem('FIRST_DRIFT_TIME', firstDriftTime);
             return; 
           }

           // Délai de persistance de 8s (plus robuste que 5s)
           if (now - parseInt(firstDriftTime) < 8000) {
             return;
           }

           const lastRelance = await AsyncStorage.getItem('LAST_RELANCE_TIME');
           
           if (!lastRelance || (now - parseInt(lastRelance)) > 30000) {
              const configJson = await AsyncStorage.getItem('SERVER_CONFIG');
              if (configJson) {
                const { ip, port } = JSON.parse(configJson);
                
                isRelanceInProgress = true;
                await AsyncStorage.setItem('LAST_RELANCE_TIME', now.toString());
                await AsyncStorage.removeItem('FIRST_DRIFT_TIME');
                
                // Correction URL : ajout du préfixe /api/
                fetch(`http://${ip}:${port}/api/relance`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    lat: currentLoc.latitude,
                    lon: currentLoc.longitude,
                    name: `Relance Auto (Dérive: ${Math.round(dist)}m)`
                  })
                }).then(() => {
                  eventBus.emit({ type: 'LOG', message: `✅ Relance auto envoyée (Dérive: ${Math.round(dist)}m)` });
                }).catch(() => {
                  // Erreur réseau
                }).finally(() => {
                  isRelanceInProgress = false;
                });
              }
           }
        } else {
           // On réinitialise le compteur de dérive si on est revenu à la normale
           await AsyncStorage.removeItem('FIRST_DRIFT_TIME');
        }
        
        // Informer l'UI si elle est ouverte
        eventBus.emit({ 
          type: 'TICK', 
          timestamp: Date.now(), 
          drift: dist,
          isMocked: dist < 200 
        });

      } catch (e) {
        // Erreur de lecture storage ou parsing
      }
    }
  });
}
