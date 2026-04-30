# Documentation Technique : Moteur de Simulation GPS (iOS 17+)

Ce document détaille l'architecture et les solutions implémentées pour garantir une simulation de localisation stable et résiliente sur Windows pour les appareils iOS 17+.

## 1. Architecture de Découverte (Cascade de Priorités)
Pour éviter les conflits entre les connexions USB et WiFi, un orchestrateur central (`tunneld-manager.js`) gère la découverte selon une priorité stricte :
- **USB (usbmuxd)** : Priorité absolue. Si détecté, le WiFi est ignoré.
- **WebSocket IP Hint** : L'application compagnon iOS envoie son IP au démarrage pour accélérer la localisation.
- **Bonjour (dns-sd)** : Scan natif des services `_apple-mobdev2._tcp`.
- **Tunneld Daemon** : Découverte passive par `pymobiledevice3`.

## 2. Le Tunnel RSD (Remote Service Discovery)
iOS 17+ impose l'utilisation de tunnels RSD sur IPv6.
- **Daemon Persistant** : L'architecture utilise désormais `pymobiledevice3 remote tunneld`. Ce mode daemon permet de gérer dynamiquement les connexions USB et WiFi sans avoir à relancer le processus manuellement.
- **Capture Automatique** : Le serveur analyse en temps réel les sorties de la commande.
    - Format détecté : `Created tunnel --rsd <IPv6> <Port>`
- **Dymanisme** : À chaque détection (nouvel appareil ou reconnexion), les informations RSD sont mises à jour et persistées dans `storage/tunnel_state.json`.

## 3. Le Pont Python (Bridge CLI-Based)
Pour résoudre les problèmes de stabilité réseau sur Windows, le pont Python (`bridge.py`) a été conçu comme un gestionnaire de processus asynchrone :
- **Exécution Native** : Au lieu d'utiliser des APIs internes, il invoque directement la commande CLI : `pymobiledevice3 developer dvt simulate-location set`.
- **Cycle de Vie** : 
    1. Réception des coordonnées + RSD Info (IP/Port).
    2. Arrêt violent (`taskkill /F /T`) de l'ancien processus de simulation.
    3. Pause de stabilisation de 500ms.
    4. Lancement du nouveau processus avec le séparateur `--` (indispensable pour gérer les coordonnées négatives).
- **Maintien** : Le processus est maintenu ouvert en arrière-plan pour empêcher iOS de réinitialiser la position réelle.

## 4. Heartbeat et Persistance
- **Lien de Confiance** : Un heartbeat est envoyé via le pont Python pour maintenir la session "Lockdown" active.
- **Condition WebSocket** : Le heartbeat ne démarre que si l'application compagnon est connectée, garantissant que l'iPhone est "réveillé".
- **Auto-Restauration** : En cas de changement d'IP ou de Port du tunnel, un Watchdog ré-injecte automatiquement la dernière position connue après 5 secondes.

## 5. Correctifs Windows Critiques
- **Errno 10109** : Résolu en forçant `socket.AI_NUMERICHOST` lors de la connexion, empêchant Windows de tenter une résolution DNS sur les adresses de tunnel.
- **Asyncio Blocking** : Utilisation exclusive de `asyncio.create_subprocess_exec` pour ne jamais geler l'interface utilisateur pendant les changements de processus.
- **Negative Coords** : Utilisation de `--` avant les arguments de latitude/longitude pour éviter qu'ils ne soient interprétés comme des drapeaux (flags) de commande.
