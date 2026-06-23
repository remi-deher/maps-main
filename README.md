# GPS‑Mock v3

![Architecture diagram](file:///C:/Users/remi2/.gemini/antigravity-ide/brain/9bda5120-ab12-43aa-ba27-9811e8e3c6e4/gpsmock_architecture_1782230207515.png)

**Suite de simulation/injection de position GPS** pour iPhone (iOS 17+, tunnel RSD via `pymobiledevice3` / `go‑ios`).

---

## Badges

[![Engine CI](https://github.com/remi-deher/maps-main/actions/workflows/engine-ci.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/engine-ci.yml)
[![Tauri App Build CI](https://github.com/remi-deher/maps-main/actions/workflows/tauri-build-ci.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/tauri-build-ci.yml)
[![iOS Companion Build CI](https://github.com/remi-deher/maps-main/actions/workflows/ios-build-ci.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/ios-build-ci.yml)
[![CodeQL](https://github.com/remi-deher/maps-main/actions/workflows/codeql.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/codeql.yml)
[![Security & Dependency Scan](https://github.com/remi-deher/maps-main/actions/workflows/security.yml/badge.svg?branch=v3-rewrite)](https://github.com/remi-deher/maps-main/actions/workflows/security.yml)

---

## Principes architecturaux

```
                     ┌──────────────────────────────┐
                     │  ENGINE (Go) — le cerveau     │
                     │  API REST + WebSocket          │
                     │  GPS sim · séquenceur · routing│
                     │  patrouille · cluster · télém.│
                     │  → tourne SEUL = headless/Docker│
                     └───────────────┬───────────────┘
                             Driver  │  interface
                 ┌───────────────────┴───────────────────┐
        ┌───────▼────────┐                       ┌────────▼───────┐
        │ GoIosDriver    │                       │ Pmd3Driver     │
        │ (go‑ios natif) │                       │ (python subproc)│
        └───┬────────┬───┘                       └───┬────────┬───┘
          USB      WiFi                            USB      WiFi
                                   ▲
                  HTTP/WS ─────────┼───────── HTTP/WS
         ┌────────────────────┐    │    ┌────────────────────┐
         │ CLIENT LOURD PC   │   │    │ APP iOS COMPAGNON │
         │ Tauri OU natif   │   │    │ Swift / SwiftUI   │
         │ UI web partagée  │   │    │ keep‑alive·AltStore│
         └────────────────────┘   │    └────────────────────┘
```

- **Moteur (Go)** – API REST + WebSocket, simulation GPS, séquenceur, routing, clustering, hot‑swap de driver/transport.
- **Tauri app** – UI desktop (React) avec le moteur en side‑car.
- **iOS companion** – App SwiftUI qui découvre le moteur via Bonjour et pilote l’injection.
- **Docker** – Conteneur headless pour les déploiements CI/CD.

---

## Diagnostics intégrés (nouveaux)

Le moteur expose maintenant un endpoint `/diagnostics` et un message WebSocket `DIAGNOSTICS` contenant :
- État du driver (version, santé, logs récents).
- Liste des périphériques USB détectés.
- Statistiques de latence du heartbeat.
- Métriques Prometheus (`engine_driver_up`, `engine_http_seconds`).
- Snapshots JSON téléchargeables via `/snapshots/latest.json`.

Ces données sont affichées dans les onglets **Settings** du client Tauri et dans la vue **Diagnostics** de l’app iOS, facilitant le support.

---

## Démarrage rapide

### Moteur (Go)
```bash
cd engine
# driver go‑ios (USB) – nécessite le binaire ios.exe sur le PATH
go run ./cmd/headless -driver go-ios -transport usb -goios-bin "C:/chemin/vers/ios.exe"
# driver pymobiledevice3 (USB)
go run ./cmd/headless -driver pymobiledevice -transport usb
# transport Wi‑Fi (RSD) – spécifier l’endpoint
go run ./cmd/headless -driver pymobiledevice -transport wifi -rsd 192.168.1.50:54321
```

### Application desktop (Tauri)
```bash
cd tauri-app
npm ci
../scripts/build-sidecar.ps1   # compile le moteur Go en side‑car
npm run tauri dev
```

### Application compagnon iOS
```bash
cd ios-app
xcodegen generate
open GpsMockCompanion.xcodeproj
# Build dans Xcode, puis installer via AltStore (voir docs/ALTSTORE.md)
```

### Docker (headless)
```bash
docker compose -f docker/compose.yaml up
# ou image publiée
docker run --rm -p 8080:8080 ghcr.io/remi-deher/maps-main/gpsmock-engine:latest
```

---

## CI / CD

Les workflows d'intégration et de déploiement continus (GitHub Actions) sont hautement optimisés :
- **Optimisation des performances** :
  - **Mise en cache intelligente** : Utilisation de `swatinem/rust-cache` pour le build de l'application desktop Tauri (gain de 5 à 10 minutes) et cache Homebrew pour XcodeGen.
  - **SwiftLint sur Linux** : Exécution de SwiftLint sur un runner `ubuntu-latest` léger via le conteneur Docker officiel de SwiftLint (économie de ressources et démarrage instantané).
  - **Réutilisation de binaire iOS** : Si le répertoire `ios-app/` n'a pas été modifié depuis le tag précédent, le workflow de release télécharge et réutilise automatiquement le compagnon `.ipa` compilé précédemment au lieu de le recompiler sur macOS.
- **Automatisation des Releases (Release Please)** :
  - Le projet utilise **Release Please** de Google. À chaque fusion sur `main` respectant le format des *Conventional Commits* (ex: `feat: ...`, `fix: ...`), un brouillon de Pull Request de release est créé ou mis à jour avec le `CHANGELOG.md` et les montées de versions automatiques.
  - Lors de la fusion de cette PR de release, le tag de version est automatiquement créé et déclenche le workflow de publication des binaires multi-plateformes et de l'image Docker.

---

## Contribuer
1. Fork the repo.
2. Créez une branche `feature/…`.
3. Run `npm ci && go test ./... && ./scripts/build-sidecar.ps1`.
4. Ouvrez une Pull Request.

---

## License
MIT – voir le fichier [LICENSE](LICENSE).

---

*Consultez les fichiers sous `docs/` pour des explications détaillées : [ARCHITECTURE.md](docs/ARCHITECTURE.md), [UI_UX_BASELINE.md](docs/UI_UX_BASELINE.md), etc.*
