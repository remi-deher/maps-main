import { registerRootComponent } from 'expo';
import * as TaskManager from 'expo-task-manager';
import { LOCATION_TASK_NAME } from './src/services/background';

// La définition de la tâche DOIT être au niveau le plus haut possible
// pour être enregistrée avant le premier rendu.
import './src/services/background';

import App from './App';

registerRootComponent(App);
