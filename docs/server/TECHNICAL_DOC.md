# 🏗 Documentation Technique — GPS Mock

Cette documentation détaille l'architecture interne du projet et les principes de conception mis en œuvre lors de la refactorisation de 2026.

## 📐 Architecture Globale

Le projet suit une architecture **orientée services** et **modulaire** pour séparer les responsabilités :

### 1. Main Process (Cœur de l'application)
- **Services (`src/main/services/`)** :
    - `GpsSimulator.js` : Encapsule les appels à `pymobiledevice3`. Gère le cycle de vie du processus et le watchdog.
    - `SettingsManager.js` : Gère la persistance de la config JSON.
- **Tunneling (`src/main/tunneld/`)** :
    - `UsbBus.js` & `WifiBus.js` : Gèrent les démons de connexion.
    - `ConnectionState.js` : Machine à état gérant la priorité (USB > WiFi).
- **Orchestrateur (`tunneld-manager.js`)** : Coordonne les services pour assurer la stabilité.
- **IPC Registry (`src/main/ipc/`)** : Point d'entrée unique pour toutes les communications avec le front-end.

### 2. Renderer Process (Interface)
- **Composants UI (`renderer/js/ui/`)** : Découpage en modules atomiques (`theme.js`, `tabs.js`, `monitor.js`, etc.).
- **Data Layer (`renderer/js/services/`)** : `StorageService.js` gère l'historique et les favoris via une abstraction du `localStorage`.

## 🧪 Stratégie de Test

Le projet utilise **Jest** pour les tests unitaires et **Playwright** pour les tests E2E.

- **Tests Unitaires** (`tests/unit/`) : Valident la logique pure (résolution Python, calcul de priorité).
- **Tests d'Intégration** (`tests/integration/`) : Valident la collaboration entre les services (ex: restauration automatique).
- **Tests E2E** (`tests/e2e/`) : Simulent un utilisateur réel dans l'environnement Electron.

## 🛠 Extension du Projet

Pour ajouter une nouvelle commande GPS :
1. Ajouter la méthode dans `src/main/services/gps-simulator.js`.
2. Enregistrer le handler dans `src/main/ipc/registry.js`.
3. Mettre à jour `preload.js` pour exposer la fonction au renderer.
4. Ajouter un test unitaire pour valider la nouvelle logique.
