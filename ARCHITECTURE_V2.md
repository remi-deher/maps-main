# Architecture GPS-Mock V2 : Unified & Agnostic

Ce document définit la stratégie technique pour transformer GPS-Mock en une plateforme universelle capable de tourner nativement sous **Windows** et **Linux**, en mode **Electron** (Interface native) ou **Headless** (Docker / Service).

## 1. Principes Fondamentaux

1.  **Core-First** : Toute la logique métier (Drivers, Simulation, Cluster) réside dans `/src/core` et est totalement ignorante de l'interface utilisateur.
2.  **Abstraction de Plateforme** : Les chemins de fichiers et les noms de commandes sont résolus dynamiquement via un `PlatformManager`.
3.  **Adapteurs de Communication** : La communication entre le Backend et le Frontend passe par une interface unique, implémentée soit par Electron (IPC), soit par Express (REST/SSE).

---

## 2. Structure du Répertoire

```text
/server
  /src
    /core               # LE CERVEAU (Agnostique)
      /drivers          # Pmd3Driver, GoIosDriver (Logique pure)
      /services         # GpsSimulator, TunnelManager, ClusterManager
      /settings         # SettingsManager (Gestion des .json)
    /platform           # ABSTRACTION OS
      binary-manager.js # Résout 'pmd3' -> 'python -m...' ou 'python3 -m...'
      path-resolver.js  # Résout les dossiers /storage et /resources
    /adapters           # LES PONTS
      electron-bridge.js # Relais IPCMain
      web-bridge.js      # Relais Express API + SSE
    /targets            # LES ENTRÉES
      electron.js       # Point d'entrée Electron (Windows Native UI)
      headless.js       # Point d'entrée Headless (Service / Docker)
  /renderer-v2          # FRONTEND UNIQUE (Vite + React)
```

---

## 3. Gestion Multi-Plateforme (BinaryManager)

Au lieu de hardcoder les appels système, le code utilise des alias logiques.

| Alias | Commande Windows (Native/VM) | Commande Linux (Docker/Native) |
| :--- | :--- | :--- |
| `python` | `python` | `python3` |
| `pmd3` | `python -m pymobiledevice3` | `python3 -m pymobiledevice3` |
| `go-ios` | `resources/ios.exe` | `/usr/local/bin/ios` |

**Exemple d'appel dans un driver :**
```javascript
// Terminé le if(platform === 'win32')
const { bin } = require('../../platform/binary-manager');
bin.spawn('pmd3', ['lockdown', 'start-tunnel']);
```

---

## 4. Modes de Déploiement

### A. Mode Electron (Desktop)
*   **Usage** : Utilisation quotidienne sur PC Windows.
*   **Lancement** : `npm run start` (Target: `electron.js`).
*   **Communication** : `ipcRenderer` <-> `ipcMain`.

### B. Mode Headless (Service Windows / Linux)
*   **Usage** : Serveur dédié, VM, ou exécution en arrière-plan sans fenêtre.
*   **Lancement** : `node src/targets/headless.js`.
*   **Communication** : `fetch/axios` <-> `Express API` + `SSE` pour les logs temps réel.

### C. Mode Docker
*   **Usage** : NAS (TrueNAS/Synology), Proxmox.
*   **Base** : Debian Slim + Node 20.
*   **Spécificité** : Utilise le point d'entrée `headless.js` avec des volumes pour le stockage.

---

## 5. Matrice de Compatibilité

| Fonctionnalité | Windows Electron | Windows Headless | Linux / Docker |
| :--- | :---: | :---: | :---: |
| Tunneling RSD (iOS 17+) | ✅ | ✅ | ✅ |
| Détection USBMUX | ✅ | ✅ | ✅ |
| Cluster Sync | ✅ | ✅ | ✅ |
| Dashboard Web | ✅ | ✅ | ✅ |
| Notification Tray | ✅ | ❌ | ❌ |

---

## 6. Guide de Développement
*   **Ajouter une fonction** : Toujours l'implémenter dans `src/core`.
*   **Exposer la fonction** : Ajouter le handler dans `src/adapters/electron-bridge.js` ET `src/adapters/web-bridge.js`.
*   **Interface** : Utiliser `window.gps` dans le React. Si `window.gps` est absent, le frontend charge automatiquement un polyfill qui redirige les appels vers l'API HTTP.
