# GPS-Mock v3

Suite de simulation/injection de position GPS pour iPhone (iOS 17+, tunnel RSD via
`pymobiledevice3` / `go-ios`). Réécriture complète à architecture neuve : un moteur
unique, plusieurs façades (headless, Docker, app desktop, app compagnon iOS).

[![Engine CI](https://github.com/remi-deher/maps-main/actions/workflows/engine-ci.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/engine-ci.yml)
[![Tauri App Build CI](https://github.com/remi-deher/maps-main/actions/workflows/tauri-build-ci.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/tauri-build-ci.yml)
[![iOS Companion Build CI](https://github.com/remi-deher/maps-main/actions/workflows/ios-build-ci.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/ios-build-ci.yml)
[![CodeQL](https://github.com/remi-deher/maps-main/actions/workflows/codeql.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/codeql.yml)
[![Security & Dependency Scan](https://github.com/remi-deher/maps-main/actions/workflows/security.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/security.yml)

## Principe : un moteur, plusieurs façades

```
                    ┌──────────────────────────────┐
                    │  ENGINE (Go) — le cerveau     │
                    │  API REST + WebSocket          │
                    │  GPS sim · séquenceur · routing│
                    │  patrouille · cluster · télém. │
                    │  → tourne SEUL = headless/Docker│
                    └───────────────┬───────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
       ┌──────▼───────┐     ┌───────▼────────┐     ┌───────▼────────┐
       │  Tauri app   │     │  App compagnon │     │  Headless /     │
       │  (desktop)   │     │  iOS (Swift)   │     │  Docker / CLI   │
       └──────────────┘     └────────────────┘     └────────────────┘
```

Le moteur expose `REST /api/*` et un WebSocket `/ws` (enveloppes `{type,data}`),
et est piloté indifféremment par un client desktop, une app iOS, ou directement
en ligne de commande / conteneur. Driver iOS **sélectionnable au runtime**
(`go-ios` ou `pymobiledevice3`), transport **USB ou WiFi**.

## Composants

| Dossier | Rôle |
|---|---|
| [`engine/`](engine) | Moteur **Go** : API REST + WebSocket, simulateur GPS, séquenceur, routing, patrouille, cluster, switch driver/transport à chaud, Live Activity côté iOS. Tourne **headless** (serveur / Docker) ou derrière une UI. |
| [`tauri-app/`](tauri-app) | Client desktop (Windows/macOS/Linux) — UI web (React) dans un shell **Tauri**, le moteur Go embarqué comme sidecar (`externalBin`). |
| [`ios-app/`](ios-app) | App compagnon **SwiftUI** (iOS 26, Liquid Glass / HIG) : découverte du moteur en Bonjour, pilotage de la simulation, itinéraires, favoris, Live Activity. Distribuée non signée (sideload AltStore). Voir [docs/UI_UX_BASELINE.md](docs/UI_UX_BASELINE.md). |
| [`spec/`](spec) | Contrat d'API (OpenAPI + AsyncAPI), **source de vérité** unique partagée par tous les clients. |
| [`docker/`](docker) | Image Docker (Linux) pour le moteur headless — voir [docker/README.md](docker/README.md). |
| [`docs/`](docs) | Architecture et contraintes ([ARCHITECTURE](docs/ARCHITECTURE.md), [ALTSTORE](docs/ALTSTORE.md), [UI_UX_BASELINE](docs/UI_UX_BASELINE.md)). |
| [`scripts/`](scripts) | Scripts de dev/build (sidecar Tauri, contrôle du moteur en CLI Windows/Linux). |
| [`legacy/`](legacy) | Ancienne implémentation Node/Electron + Expo, gardée comme référence jusqu'à parité fonctionnelle. |

## Démarrage rapide

### Moteur (Go)

```bash
cd engine

# go-ios en USB (nécessite un iPhone branché + privilèges admin)
go run ./cmd/headless -driver go-ios -transport usb \
  -goios-bin "../legacy/server/resources/ios.exe"

# pymobiledevice3 en USB (nécessite python + pymobiledevice3 installés)
go run ./cmd/headless -driver pymobiledevice -transport usb

# transport WiFi : pointer directement sur un endpoint RSD (host:port)
go run ./cmd/headless -driver pymobiledevice -transport wifi -rsd 192.168.1.50:54321

# sans tunnel (test de l'API seule)
go run ./cmd/headless -no-tunnel

# cluster HA : auto-découverte des pairs en mDNS (pas d'IP à saisir)
go run ./cmd/headless -cluster-mode auto

# cluster HA : liste manuelle de pairs
go run ./cmd/headless -cluster-mode manual -cluster-nodes 192.168.1.10:8080,192.168.1.11:8080
```

> L'injection GPS réelle requiert un iPhone connecté et les privilèges du tunnel.

Le mode cluster (`-cluster-mode off|manual|auto`) porte la haute disponibilité maître/esclave du
serveur legacy (heartbeat, takeover automatique, synchronisation) — en mode `auto`, les pairs sont
découverts via le même service Bonjour/mDNS (`_gpsmock._tcp`) que celui utilisé par l'app iOS, sans
configuration d'IP. `-cluster-mode`, `-cluster-nodes` et `-cluster-sync-certs` sont aussi modifiables
à chaud via `SAVE_SETTINGS`.

`-cluster-sync-certs` (désactivé par défaut) réplique en plus le dossier Lockdown (pairing records
iOS) entre les nœuds du cluster — un nœud esclave promu maître peut alors reprendre l'injection sur
un device déjà appairé sur un autre nœud sans avoir à le ré-appairer.

### App desktop (Tauri)

```bash
cd tauri-app
npm install
./../scripts/build-sidecar.ps1   # compile le moteur Go en sidecar Tauri
npm run tauri dev
```

### App compagnon iOS

```bash
cd ios-app
xcodegen generate
open GpsMockCompanion.xcodeproj
```

Build non signé en CI, à installer via AltStore (voir [docs/ALTSTORE.md](docs/ALTSTORE.md)).

### Docker (moteur headless)

```bash
docker compose -f docker/compose.yaml up
# ou, image publiée :
docker run --rm -p 8080:8080 ghcr.io/remi-deher/maps-main/gpsmock-engine:latest
```

## CI/CD

- **Build & tests** : [Engine CI](.github/workflows/engine-ci.yml) (Go, multi-OS, race detector, seuil de couverture), [Tauri App Build CI](.github/workflows/tauri-build-ci.yml), [iOS Companion Build CI](.github/workflows/ios-build-ci.yml), [Swift Lint](.github/workflows/swift-lint.yml), [Specs CI](.github/workflows/specs-ci.yml), [Scripts Lint](.github/workflows/scripts-lint.yml).
- **Sécurité & dépendances** : [CodeQL](.github/workflows/codeql.yml) (Go + Swift), [Security & Dependency Scan](.github/workflows/security.yml) (`govulncheck`, `npm audit`, `cargo audit`, scan Trivy de l'image Docker), [Dependency Review](.github/workflows/dependency-review.yml) sur chaque PR, mises à jour automatiques via [Dependabot](.github/dependabot.yml).
- **Release** : [Release](.github/workflows/release.yml) — sur tag `v*`, build et publie les binaires du moteur (toutes plateformes), les bundles desktop Tauri (Windows/macOS/Linux), l'IPA iOS non signé, et pousse l'image Docker du moteur sur GitHub Container Registry (`ghcr.io`).

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour la roadmap complète.
