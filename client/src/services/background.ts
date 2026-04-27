import * as TaskManager from 'expo-task-manager';
// background.ts (v1.2.3-events-fix)
import * as Location from 'expo-location';
import { EventEmitter } from 'events';

export const LOCATION_TASK_NAME = 'background-location-task';
export const eventBus = new EventEmitter();

let isRelanceInProgress = false;

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
      eventBus.emit('location-update', { latitude, longitude });

      // Détection de dérive (Relance automatique)
      // On compare avec la position "voulue" si on l'a (optionnel)
    }
  }
});
