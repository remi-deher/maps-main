# WiFi Discovery & Tunneling Architecture (iOS 17/18)

Ce document explique comment l'application parvient à détecter et à se connecter aux iPhones récents (iPhone 16) via WiFi, en contournant les restrictions de sécurité d'iOS 18 et les instabilités réseau de Windows.

---

## 1. Concept Global (Vision Humaine)

Depuis iOS 17, Apple n'autorise plus les connexions directes vers les services de l'iPhone. Tout doit passer par un **Tunnel sécurisé** (similaire à un VPN privé entre votre PC et l'iPhone).

**Le défi** : Pour créer ce tunnel, votre PC doit "trouver" l'iPhone sur le WiFi. Mais Windows bloque souvent les signaux de recherche (mDNS/Bonjour). 

**La solution** : L'application utilise une stratégie en deux étapes :
1.  **Le Démon Automatique** : Elle lance un moteur qui écoute le réseau en permanence.
2.  **Le Pont de Secours** : Si le moteur automatique est "aveugle", l'appli utilise les outils natifs de Windows (`dns-sd`) pour forcer la découverte.

---

## 2. Spécifications Techniques (IA-Ready)

> [!NOTE]
> Cette section est conçue pour être lue par une IA afin de restaurer ou modifier le système.

### A. Composants Clés
- **Démon Principal** : `pymobiledevice3 remote tunneld`
- **Protocole** : CoreDevice (RemoteXPC over QUIC/TCP)
- **Transport** : IPv6 Link-Local (`fe80::...`) avec Scope ID (`%index`)
- **Service mDNS** : `_apple-mobdev2._tcp.local.`

### B. Flux de Découverte (Séquentiel)

#### Étape 1 : Tunneld Unifié (Automatique)
L'application lance `TunneldService` (via `tunneld-service.js`). 
Elle écoute le `stdout` du processus Python pour capturer la ligne de création de tunnel :
- **Regex de capture** : `/--rsd\s+([\w:.]+)\s+(\d+)/`
- **ID de l'appareil** : `/\[start-tunnel-task-usbmux-([^-]+)-(\w+)\]/`

#### Étape 2 : Pont Bonjour Natif (Fallback)
Si aucun tunnel n'est détecté après 10s, `NativeBonjour` (via `native-bonjour.js`) est activé :
1.  **Scan** : `dns-sd -B _apple-mobdev2._tcp`
2.  **Extraction** : Capture l'adresse IPv6 et l'index d'interface (ex: `16`) depuis l'Instance Name.
3.  **Résolution/Probe** : Si `dns-sd -L` échoue, effectue un scan TCP (Socket brute) sur l'IPv6 Link-Local (`fe80::...%16`) sur les ports probables (53248, 53400+, 62000+).

### C. Connectivité & Simulation
Une fois le port RSD trouvé (ex: `62377`) et l'adresse IP de tunnel obtenue (ex: `fdda:f46b:62c8::1`), la simulation est lancée via :
`python -m pymobiledevice3 developer dvt simulate-location set --rsd <ADDR> <PORT> -- <LAT> <LON>`

---

## 3. Guide de Dépannage (Troubleshooting)

| Symptôme | Cause Probable | Solution |
| :--- | :--- | :--- |
| **WinError 64** | Connexion directe tentée sans tunnel | Vérifier que `tunneld` est bien lancé. |
| **Device Not Found** | mDNS bloqué (Pare-feu / Docker) | Désactiver Docker Desktop et WSL. Mettre le WiFi en mode "Privé". |
| **Tunnel vide** | Service Bonjour Apple absent | Installer l'app "Appareils Apple" depuis le Windows Store. |

---

## 4. Maintenance de l'Environnement Python
L'environnement se situe dans `./resources/python/`. 
Les dépendances critiques sont :
- `pymobiledevice3 >= 9.10.0`
- `pytun-pmd3` (pour le driver de tunnel Windows)
