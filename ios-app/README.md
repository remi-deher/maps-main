# GPS-Mock Companion (iOS)

App SwiftUI minimale qui tourne sur l'iPhone à côté de l'app GPS-Mock
desktop. Son seul rôle : remonter la position réelle de l'appareil
(`REAL_LOCATION`) au moteur Go, qui s'en sert pour le bouclier anti-dérive
(re-injecter la position simulée si elle a trop dérivé — voir
`engine/internal/engine/engine.go`, `ReportRealLocation`).

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
3. Dans l'app, saisir l'IP:port du PC qui fait tourner le moteur GPS-Mock
   (ex. `192.168.1.42:8080` — le moteur écoute déjà sur toutes les
   interfaces, pas seulement `localhost`).
4. Autoriser l'accès à la localisation, puis "Connecter".
