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

## Démarrage (moteur, phase 1)

```bash
cd engine
go run ./cmd/headless                          # driver par défaut
go run ./cmd/headless -driver go-ios -transport usb
```

> Phase 1 = contrats uniquement : le moteur valide le câblage (sélection
> driver/transport) puis s'arrête ; aucun backend n'est encore implémenté.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour la roadmap complète.
