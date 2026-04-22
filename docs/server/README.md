# 📍 GPS Mock — iPhone Location Spoofer

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Electron](https://img.shields.io/badge/electron-29.4.6-brightgreen.svg)

**GPS Mock** est une application puissante permettant de simuler la position GPS de votre iPhone directement depuis votre PC Windows. Elle utilise la suite `pymobiledevice3` pour communiquer de manière sécurisée avec le service de développeur (DVT) d'iOS.

## 🚀 Fonctionnalités

- **🌐 Connexion Hybride** : Supporte l'USB et le WiFi (avec basculement automatique ultra-rapide).
- **🎯 Téléportation Précise** : Cliquez n'importe où sur la carte pour changer la position de l'iPhone.
- **🔍 Recherche Puissante** : Trouvez des adresses, des villes ou des monuments via Nominatim (OSM).
- **⭐ Favoris & Historique** : Enregistrez vos lieux préférés et retrouvez vos dernières positions.
- **🔄 Restauration Automatique** : Si le tunnel se coupe, la simulation est relancée dès que la connexion revient.
- **🌓 Mode Sombre/Clair** : Interface moderne et élégante s'adaptant à vos préférences.

## 🛠 Installation

1.  **Prérequis** : Avoir un iPhone avec le "Mode Développeur" activé (Réglages > Confidentialité et sécurité).
2.  **Lancement** : Exécutez `start.bat` ou lancez l'application via `npm start`.
3.  **Appairage** : Branchez votre iPhone en USB la première fois pour initialiser le tunnel de confiance.

## 📡 Modes de Connexion

- **Mode USB** : Le mode le plus stable. Plug-and-play.
- **Mode WiFi** : Nécessite que l'iPhone et le PC soient sur le même réseau. Vous pouvez saisir manuellement l'IP de votre iPhone dans l'onglet **🔧 Config** pour une stabilité accrue (pas besoin de Bonjour/mDNS).

## 🧪 Tests

Ce projet inclut une suite de tests complète (Unitaires, Intégration, E2E) développée avec **Jest** et **Playwright**.
```powershell
npm test
```

## 📜 Licence
Distribué sous licence MIT. Voir `LICENSE` pour plus d'informations.
