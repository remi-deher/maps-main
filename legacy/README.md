# 📍 GPS Mock — Suite de Simulation

Projet de simulation GPS pour iPhone (iOS 17+ / CoreDevice) composé d'une application de bureau (Serveur) et d'une application mobile (Client).

## 📂 Structure du Projet

- **`server/`** : Application Electron + Python (pymobiledevice3). C'est le cœur du système qui injecte la position dans l'iPhone.
- **`client/`** : Application iOS (SwiftUI) permettant de monitorer le tunnel et de maintenir la session active.
- **`docs/`** : Documentation technique et utilisateur.
    - `docs/server/` : Installation et fonctionnement de l'application PC.
    - `docs/client/` : Guide de l'application iOS.

## 🚀 Démarrage Rapide (Serveur)

1. Rendez-vous dans le dossier `server/`.
2. Lancez `start.bat` (en tant qu'Administrateur).

## 📡 Documentation

Consultez [TECHNICAL_DOC.md](./docs/server/TECHNICAL_DOC.md) pour plus de détails sur l'architecture.
