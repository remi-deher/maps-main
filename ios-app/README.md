# GPS-Mock Companion (iOS)

App SwiftUI, façon Plans (carte plein écran MapKit + feuille flottante), qui
tourne sur l'iPhone à côté de l'app GPS-Mock desktop :

- Affiche la position réelle (point bleu) et la position simulée (pin) sur la
  carte. Toucher la carte propose de téléporter, lancer un trajet jusqu'ici,
  ou ajouter un favori.
- Barre de recherche d'adresse (`MKLocalSearch`, natif, pas de clé API) —
  sélectionner un résultat recentre la carte et ouvre le même menu d'actions
  qu'un tap sur la carte.
- Découverte automatique du moteur sur le réseau local via Bonjour/mDNS
  (`_gpsmock._tcp`, voir `EngineDiscovery.swift`) : plus besoin de taper
  l'IP:port à la main si le moteur est sur le même réseau. Le moteur Go
  s'annonce lui-même au démarrage (`engine/cmd/headless/run.go`,
  `advertiseMdns`) — desktop comme headless, puisque c'est le même binaire.
- Liste les favoris du moteur (ajout/suppression/téléportation en un tap).
- Remonte la position réelle de l'appareil (`REAL_LOCATION`) toutes les 10s
  pour le bouclier anti-dérive du moteur (re-injecte la position simulée si
  elle a trop dérivé — voir `engine/internal/engine/engine.go`,
  `ReportRealLocation`).

Le moteur Go est l'unique source de vérité et diffuse son état à **tous**
les clients connectés (desktop, iOS, headless via le hub WebSocket) — donc
piloter depuis le téléphone, le bureau ou un client headless reste
automatiquement cohérent, sans logique de sync supplémentaire à écrire ici.

Elle parle le même protocole WebSocket `{type, data}` que `tauri-app`
(`engine/internal/api/messages.go`), donc tout changement de contrat côté
moteur doit être répercuté ici aussi.

## Build local (macOS + Xcode requis)

```bash
brew install xcodegen
cd ios-app
xcodegen generate
open GpsMockCompanion.xcodeproj
```

Le projet `.xcodeproj` est généré depuis `project.yml` (XcodeGen) — il n'est
jamais commité, ne l'éditez pas directement.

## CI (`.github/workflows/ios-build-ci.yml`)

Compile un `.ipa` **non signé** sur un runner `macos-latest` et le publie en
artifact. Pas de certificat ni de secret Apple à configurer : l'app est
pensée pour être installée via **AltStore**, qui la re-signe lui-même avec
un Apple ID gratuit au moment de l'installation (valable 7 jours, à
réinstaller/rafraîchir depuis AltStore quand le certificat expire).

## Utilisation

1. Récupérer le `.ipa` depuis l'artifact du workflow (Actions → run → Artifacts).
2. L'installer via AltStore/AltServer sur l'iPhone.
3. Autoriser l'accès à la localisation et au réseau local (popup iOS) :
   l'app cherche automatiquement le moteur en Bonjour et se connecte seule
   si elle le trouve. Sinon, saisir l'IP:port du PC manuellement
   (ex. `192.168.1.42:8080`) puis "Connecter".
