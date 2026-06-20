# GPS-Mock v3

Suite de simulation/injection de position GPS pour iPhone (iOS 17+, tunnel RSD via
`pymobiledevice3` / `go-ios`). Réécriture complète à architecture neuve.

## Composants

- **`engine/`** — moteur **Go** (le cerveau) : API REST + WebSocket, simulateur GPS,
  séquenceur, routing, patrouille, cluster. Tourne **headless** (serveur / Docker) ou
  derrière une UI. Driver iOS **sélectionnable** (`go-ios` ou `pymobiledevice3`),
  transport **USB ou WiFi**.
- **`spec/`** — contrat d'API (OpenAPI + AsyncAPI), **source de vérité** unique.
- **`desktop/`** — *(à venir)* client lourd PC (UI web + shell Tauri/natif).
- **`ios/`** — *(à venir)* app Swift compagnon (keep-alive, sideload AltStore).
- **`docker/`** — *(à venir)* images Linux / Windows-WSL.
- **`docs/`** — architecture et contraintes ([ARCHITECTURE](docs/ARCHITECTURE.md),
  [ALTSTORE](docs/ALTSTORE.md)).
- **`legacy/`** — ancienne implémentation Node/Electron + Expo, gardée comme référence
  jusqu'à parité fonctionnelle.

## Démarrage (moteur)

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
```

Le serveur expose `REST /api/*` et un WebSocket `/ws` (enveloppes `{type,data}`).
Le **menu** combine driver (`go-ios` ↔ `pymobiledevice`) et transport (`usb` ↔ `wifi`).

> L'injection GPS réelle requiert un iPhone connecté et les privilèges du tunnel.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour la roadmap complète.
