# Architecture — GPS-Mock v3

Réécriture complète de la suite de simulation GPS iOS (iOS 17+, tunnel RSD).
Objectif identique au projet d'origine, architecture neuve et multi-cibles.

## Principe : un moteur, plusieurs façades

```
                    ┌──────────────────────────────┐
                    │  ENGINE (Go) — le cerveau     │
                    │  API REST + WebSocket          │
                    │  GPS sim · séquenceur · routing│
                    │  patrouille · cluster · télém. │
                    │  → tourne SEUL = headless/Docker│
                    └───────────────┬───────────────┘
                            Driver  │  interface
                ┌───────────────────┴───────────────────┐
        ┌───────▼────────┐                       ┌────────▼───────┐
        │ GoIosDriver    │                       │ Pmd3Driver     │
        │ (go-ios natif) │                       │ (python subproc)│
        └───┬────────┬───┘                       └───┬────────┬───┘
          USB      WiFi                            USB      WiFi
                                  ▲
                 HTTP/WS ─────────┼───────── HTTP/WS
        ┌────────────────────┐    │    ┌────────────────────┐
        │ CLIENT LOURD PC     │   │    │ APP iOS COMPAGNON   │
        │ Tauri OU natif (TBD) │  │    │ Swift / SwiftUI      │
        │ UI web partagée      │  │    │ keep-alive · AltStore│
        └────────────────────┘    │    └────────────────────┘
```

- **Le moteur est l'unique implémentation canonique** de la logique métier. On ne
  maintient pas d'orchestrateur Python en parallèle (cela dupliquerait le cerveau).
  Un éventuel orchestrateur Python resterait une façade « compat » plus légère,
  derrière le **contrat d'API figé** (`/spec`).
- **Le contrat d'API (`/spec/openapi.yaml` + `/spec/asyncapi.yaml`) est la source de
  vérité** partagée par tous les clients. Tout passe par lui ; aucun client ne dépend
  du code interne du moteur.

## Double abstraction : driver ET transport

Le point structurant. Deux axes interchangeables au runtime (le « menu ») :

| Axe | Choix | Où |
| --- | --- | --- |
| **Driver** | `go-ios` (Go natif, zéro Python) · `pymobiledevice3` (sous-processus Python) | `engine/internal/driver` |
| **Transport** | `USB` · `WiFi/RSD` · `Auto` | `TransportKind`, `Classify()` |

- Choisir **go-ios** ⇒ aucun runtime Python requis (binaire seul).
- Choisir **pmd3** ⇒ Python lancé en sous-processus.
- `Classify(address)` déduit USB vs WiFi d'après l'adresse RSD (loopback / `fe80::` ⇒ USB).

L'interface `Driver` (`engine/internal/driver/driver.go`) reprend le `BaseDriver`
historique : `StartTunnel/StopTunnel/SetLocation/ClearLocation/CheckHealth/ListDevices`.
Le **registre** (`registry.go`) mappe `DriverID → Factory` ; `New(id, cfg)` est le menu.

> Avant de toucher au tunnel WiFi iOS 17+ (RSD) ou de déboguer un device qui
> ne se connecte pas en WiFi malgré l'USB, voir
> [IOS_PAIRING_TUNNEL.md](IOS_PAIRING_TUNNEL.md) — le pairing Lockdown
> (trust USB) est un prérequis invisible mais bloquant pour les deux
> drivers.

## Arborescence

```
/engine                      # moteur Go (binaire unique)
  cmd/headless               # entrée serveur / Docker
  internal/domain            # types métier (agnostiques)
  internal/driver            # interface Driver, Transport, registre, stubs
  internal/api               # contrat filaire : messages WS + Status
  internal/settings          # schéma de configuration + défauts
/spec                        # SOURCE DE VÉRITÉ du contrat
  openapi.yaml               # REST
  asyncapi.yaml              # WebSocket (JSON brut, enveloppe {type,data})
/desktop                     # (à venir) UI web + shell Tauri/natif
/ios                         # (à venir) app Swift compagnon
/docker                      # images Linux / Windows-WSL (Phase 4)
/docs                        # cette doc + ALTSTORE.md
```

`/legacy` (ancienne implémentation Node/Electron + Expo) a été supprimé une fois la parité
fonctionnelle atteinte — toujours consultable dans l'historique Git si besoin.

## Cibles de déploiement

| | Linux | Windows | macOS |
| --- | :---: | :---: | :---: |
| Headless (binaire Go) | ✅ | ✅ | ✅ |
| Docker — WiFi/RSD | ✅ | ✅ (WSL2) | ⚠️ |
| Docker — USB | ✅ (`--privileged` + usbmuxd) | ⚠️ (usbipd-win, best effort) | ❌ |
| Client lourd PC | ✅ | ✅ | ✅ |

## Temps réel

WebSocket **brut + JSON** (pas de socket.io). Chaque message est une enveloppe
`{ "type": <ACTION|EVENT>, "data": {...} }`. Vocabulaire exhaustif dans
`engine/internal/api/messages.go` et décrit dans `spec/asyncapi.yaml`.

## Dockerisation (Phase 4)

Le moteur supporte pleinement l'exécution conteneurisée via Docker. Les scénarios clés sont pris en compte dans le répertoire `/docker` :
- **WiFi (Tous OS)** : Exécution légère sans périphérique local, en ciblant directement l'adresse RSD (`GPSMOCK_RSD`).
- **USB (Linux/WSL2)** : Passthrough du socket `/var/run/usbmuxd`, des clés d'appairage `/var/lib/lockdown`, et droits réseau (`NET_ADMIN`) avec accès au device `/dev/net/tun` pour initier le tunnel RSD local.

Les détails de construction et d'exécution sont documentés dans le [README Docker](file:///c:/Users/remi2/Documents/GitHub/maps-main/docker/README.md).

## Roadmap

1. **Contrats & squelette** — interfaces, types, specs, stubs.
2. Engine Go + `GoIosDriver` USB — 1er flux d'injection bout-en-bout.
3. `Pmd3Driver` + transport WiFi/RSD — le menu complet.
4. **Dockerisation (Linux USB+WiFi, Windows-WSL WiFi)** (cette phase).
5. UI web sur l'API, puis packaging Tauri/natif.
6. App iOS Swift (keep-alive background, AltStore). Suppression de `/legacy` à parité — fait.
