import * as TaskManager from 'expo-task-manager';

export const LOCATION_TASK_NAME = 'background-location-task';

// Bus d'événement global pour la communication inter-processus (UI <-> Task)
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

// Définition de la tâche de fond (doit être définie au niveau racine)
if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
    if (error) return;
    if (data) {
      eventBus.emit({ type: 'TICK', timestamp: Date.now() });
    }
  });
}
