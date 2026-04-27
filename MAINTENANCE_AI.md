# Documentation Technique & Maintenance (Spécial IA)

Ce document résume l'architecture, les commandes critiques et les correctifs appliqués pour stabiliser la simulation GPS entre l'iPhone (iOS 17+) et le serveur PC.

## 🏗️ Architecture Globale

- **Client (iPhone)** : Application Expo (React Native) + TypeScript + Zustand.
  - Utilise `Socket.io-client` pour la communication bidirectionnelle.
  - **Hook Critique** : `Location.watchPositionAsync` renvoie la position "réelle" au serveur toutes les 10s pour vérification.
- **Serveur (PC)** : Node.js (Electron / Headless Docker) + Express + Socket.io.
  - **Orchestrateur** : `tunneld-manager.js` gère le cycle de vie des drivers.
  - **Simulateur** : `gps-simulator.js` gère l'injection et le throttling (500ms).
- **Communication** : Protocoles Socket.io (iPhone) et SSE/HTTP (Dashboard Docker).

## 🛠️ Commandes Critiques

### 1. Montage du Tunnel (via pymobiledevice3)
```bash
python.exe -m pymobiledevice3 remote tunneld
```
- **Rôle** : Crée un tunnel RSD (Remote Server Discovery) indispensable sur iOS 17+.
- **Output** : Renvoie une ligne `--rsd ADDRESS PORT`.
- **Note** : Le serveur capture cette adresse (souvent une ULA IPv6 type `fd00::`) pour les commandes de simulation.

### 2. Injection de Position (DVT)
```bash
python.exe -m pymobiledevice3 developer dvt simulate-location set --rsd ADDRESS PORT -- LAT LON
```
- **Piège IPv6** : L'adresse `ADDRESS` **ne doit pas** contenir de crochets `[ ]`. Exemple valide : `fd81:f1c1:9751::1`.
- **Throttling** : Limité à 500ms minimum pour éviter la congestion du service DVT sur l'iPhone.

## 🚑 Correctifs Historiques (Knowledge Base)

### 1. Crash au démarrage iOS (Background Tasks)
- **Problème** : L'application crashait immédiatement sur iPhone si `TaskManager.defineTask` n'était pas appelé au tout début du bundle JS.
- **Solution** : Déplacer `TaskManager.defineTask` au niveau module dans `index.tsx` ou `App.tsx`, avant le montage du composant React.

### 2. IPv6 et Timeouts sur Windows
- **Problème** : Les adresses IPv6 complexes renvoyées par le tunnel sont parfois injoignables en injection directe.
- **Solution** : 
  1. Nettoyage du **Scope ID** (ex: `%12`) dans les adresses IPv6.
  2. Implémentation d'un **Fallback automatique sur `::1`** (Loopback) si l'IP du tunnel répond par un Timeout.

### 3. Conflits de Drivers
- **Problème** : `go-ios` et `pymobiledevice3` se battent pour l'accès exclusif au service usbmuxd (USB).
- **Solution** : Priorité absolue donnée à `pymobiledevice3` dans l'orchestrateur si les deux sont sélectionnés. `go-ios` est désactivé préventivement.

### 4. Déploiement Docker (Windows Host)
- **Problème** : Les scripts `.sh` (entrypoint) échouent avec `no such file or directory` à cause des fins de ligne Windows (CRLF).
- **Solution** : Générer le script de démarrage directement dans le `Dockerfile` via une commande `CMD` ou `printf` pour garantir un format Linux pur.

## 📈 Feedback Loop (Vérification)

Le serveur maintient deux états :
- `lastInjectedLocation` : La position envoyée par le PC.
- `lastRealLocation` : La position rapportée par l'iPhone.

**Calcul de dérive (Drift)** : Si la distance entre ces deux points est > 50m, le serveur émet une alerte `DÉRIVE DÉTECTÉE`. Cela confirme si la simulation est réellement "prise en compte" par le GPS matériel de l'iPhone.

---
*Document généré pour assistance IA - Ne pas supprimer.*
