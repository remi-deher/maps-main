console.log("BOOTSTRAP: Initialisation de l'application...");
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
console.log("BOOTSTRAP: registerRootComponent appelé");
