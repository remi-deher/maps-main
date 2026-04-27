import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from './background';

export const initServices = async (): Promise<void> => {
  console.log("[INIT] Démarrage des services...");
  
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    console.log("[INIT] Permissions non accordées");
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (isRegistered) {
    console.log("[INIT] Tâche de fond active");
  }
};
