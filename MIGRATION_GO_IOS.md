# Architecture Hybride : Go-iOS + Pymobiledevice3

Ce document explique l'architecture mise en place pour stabiliser la simulation GPS sur iOS 17+ (et versions supérieures) sous Windows.

## 1. Problématique Initiale
L'utilisation directe de `pymobiledevice3` (Python) pour la gestion du tunnel réseau sur Windows présentait plusieurs instabilités critiques :
- **WinError 121** : Déconnexions aléatoires dues à la gestion des sockets IPv6 link-local.
- **Race conditions** : Difficulté à maintenir l'interface réseau `utun` stable sur Windows.
- **Lenteur** : Temps de montage du tunnel supérieur à 10-15 secondes.

## 2. Solution : L'Architecture Hybride
Pour résoudre ces problèmes, nous avons séparé la gestion du **réseau** de la gestion de la **commande**.

### Composants :
1.  **Go-iOS (`ios.exe`)** : Gère le tunnel de bas niveau. 
    - Utilise le pilote `Wintun` (natif) pour une stabilité réseau maximale.
    - Expose une API REST locale sur le port `28100` pour fournir les informations du tunnel.
2.  **Pymobiledevice3 (`python.exe`)** : Utilisé uniquement comme "émetteur d'ordre".
    - Ne gère plus le réseau.
    - Se connecte au tunnel déjà ouvert par Go-iOS via l'argument `--rsd`.
    - Envoie la coordonnée GPS via le protocole DVT (Developer Tools).

## 3. Flux de données
1.  **Initialisation** : `TunneldService` lance `ios.exe tunnel start`.
2.  **Découverte** : `GpsBridge` interroge `http://127.0.0.1:28100/tunnels` pour récupérer l'adresse IPv6 et le port RSD du tunnel actif.
3.  **Injection** : Au mouvement du marqueur, `GpsBridge` exécute la commande suivante dans un shell :
    ```powershell
    python.exe -m pymobiledevice3 developer dvt simulate-location set --rsd <ADDRESS> <PORT> -- <LAT> <LON>
    ```
4.  **Maintien** : Le processus Python est maintenu en arrière-plan tant qu'une nouvelle coordonnée n'est pas envoyée, garantissant que le service DVT sur l'iPhone reste actif.

## 4. Points d'attention techniques
- **Privilèges** : L'application doit être lancée en **Administrateur** pour permettre à Go-iOS de créer l'adaptateur réseau virtuel.
- **Dépendances** : `wintun.dll` doit être présent dans le dossier de `ios.exe`.
- **Coordonnées Négatives** : L'utilisation du séparateur `--` dans la commande Python est obligatoire pour éviter que les longitudes négatives ne soient interprétées comme des options CLI.
- **Shell Mode** : Sous Windows, l'utilisation de `shell: true` dans Node.js est nécessaire pour que Python reçoive correctement les arguments via Electron.

## 5. Avantages
- **Stabilité** : Le tunnel ne coupe plus, même lors d'injections rapides.
- **Vitesse** : L'injection est quasi-instantanée une fois le tunnel monté.
- **Compatibilité WiFi** : `go-ios` supporte nativement le tunneling via WiFi si l'iPhone est synchronisé.
