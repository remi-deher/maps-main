# Docker — GPS-Mock Engine

Ce répertoire contient la configuration Docker pour exécuter le moteur **GPS-Mock** en mode **headless** (sans interface utilisateur).

---

## 🛠️ Construction de l'image

L'image est basée sur une compilation multi-stage :
1. **Étape 1 (Build)** : Télécharge les dépendances Go, compile le binaire Go statique du moteur, puis compile `go-ios` directement depuis ses sources (garantit le support natif de n'importe quelle architecture comme AMD64 ou ARM64/Apple Silicon).
2. **Étape 2 (Runtime)** : Génère une image légère sous `debian:bookworm-slim` contenant le moteur, un environnement virtuel Python (`venv`) isolé pour `pymobiledevice3`, et les dépendances nécessaires.

Depuis la racine du dépôt :

```bash
docker build -f docker/Dockerfile -t gpsmock-engine .
```

### Options de build (Arguments)

Vous pouvez désactiver l'un des drivers ou changer la version de `go-ios` au moment de la construction :

| Argument | Description | Valeur par défaut |
|---|---|---|
| `WITH_PYMOBILEDEVICE` | Installer Python 3 + `pymobiledevice3` | `1` (Activé) |
| `WITH_GOIOS` | Compiler et installer `go-ios` | `1` (Activé) |
| `GOIOS_VERSION` | Version de la release `go-ios` à installer | `v1.2.0` |
| `GOIOS_QUIC_GO_VERSION` | Version de `quic-go` forcée pendant le build `go-ios` | `v0.59.1` |
| `GOIOS_X_CRYPTO_VERSION` | Version de `golang.org/x/crypto` forcée pendant le build `go-ios` | `v0.53.0` |
| `GOIOS_X_NET_VERSION` | Version de `golang.org/x/net` forcée pendant le build `go-ios` | `v0.56.0` |

Exemple pour construire sans Python/pymobiledevice3 :

```bash
docker build --build-arg WITH_PYMOBILEDEVICE=0 -f docker/Dockerfile -t gpsmock-engine .
```

---

## 🔒 Sécurité et Exposition de l'API

> [!WARNING]
> Le moteur Go n'implémente aucun mécanisme d'authentification et autorise par défaut toutes les origines pour les WebSockets (`CheckOrigin` accepte tout).
> **Si vous exposez le port `8080` sur toutes les interfaces (`0.0.0.0`), n'importe quelle machine de votre réseau local pourra piloter l'injection GPS de votre appareil.**
> 
> **Recommandations :**
> - **Liaison locale (localhost)** : Liez systématiquement le port à l'adresse de loopback de votre machine (`127.0.0.1`). C'est la configuration par défaut de notre fichier `compose.yaml` (`127.0.0.1:8080:8080`).
> - **Accès distant sécurisé** : Si vous devez y accéder à distance, utilisez un tunnel SSH, un VPN (ex: WireGuard) ou un reverse proxy avec authentification (ex: Nginx, Caddy BasicAuth).

---

## 👤 Privilèges d'exécution

- **Par défaut (Mode WiFi/Réseau)** : L'image s'exécute sous un utilisateur système non-privilégié nommé `gpsmock` (UID 10001). C'est la configuration la plus sûre.
- **Mode USB (Linux uniquement)** : Pour communiquer avec le démon USB de l'hôte (`usbmuxd`) et créer le tunnel RSD (interface réseau virtuelle `TUN`), le moteur nécessite des privilèges root. Vous devez donc forcer l'exécution avec l'utilisateur `root` (`--user root` ou `user: root` dans Docker Compose) et ajouter les droits réseau (`--cap-add=NET_ADMIN --device=/dev/net/tun`).

---

## 🚀 Utilisation (Docker CLI)

### 1. Mode WiFi (Recommandé / Linux, macOS & Windows)

Dans ce mode, le moteur se connecte directement à un endpoint RSD déjà actif sur le réseau. Le conteneur tourne de manière isolée en non-root.

#### Sur Linux ou macOS :
```bash
docker run --rm -p 127.0.0.1:8080:8080 \
  -e GPSMOCK_DRIVER=pymobiledevice \
  -e GPSMOCK_TRANSPORT=wifi \
  -e GPSMOCK_RSD=192.168.1.50:54321 \
  gpsmock-engine
```

#### Sur Windows (PowerShell via WSL2 / Docker Desktop) :
```powershell
docker run --rm -p 127.0.0.1:8080:8080 `
  -e GPSMOCK_DRIVER=pymobiledevice `
  -e GPSMOCK_TRANSPORT=wifi `
  -e GPSMOCK_RSD=192.168.1.50:54321 `
  gpsmock-engine
```

---

### 2. Mode USB (Linux uniquement)

Exécutez le conteneur en root pour lui donner accès au socket `usbmuxd` et lui permettre de gérer le tunnel RSD local.

```bash
docker run --rm --user root -p 127.0.0.1:8080:8080 \
  --cap-add NET_ADMIN \
  --device /dev/net/tun \
  -v /var/run/usbmuxd:/var/run/usbmuxd \
  -v /var/lib/lockdown:/var/lib/lockdown \
  -e GPSMOCK_DRIVER=go-ios \
  -e GPSMOCK_TRANSPORT=usb \
  gpsmock-engine
```

---

## 🎛️ Utilisation avec Docker Compose

Deux services sont prédéfinis dans `compose.yaml` (WiFi et USB).

### Service WiFi
```bash
export GPSMOCK_RSD="192.168.1.50:54321"
docker compose -f docker/compose.yaml up gpsmock-wifi
```

### Service USB (Linux)
Le service `gpsmock-usb` bascule automatiquement sur l'utilisateur `root` et configure les montages et droits requis.
```bash
docker compose -f docker/compose.yaml up gpsmock-usb
```

---

## 🔍 Diagnostic, Santé et Arrêt Propre

### Vérifier la santé du conteneur

L'image Docker contient un `HEALTHCHECK` basé sur `curl` qui interroge régulièrement l'endpoint `/api/status`. Vous pouvez suivre le statut avec :

```bash
docker ps
# Le conteneur doit afficher "(healthy)" après quelques secondes.
```

### Arrêt propre (Graceful Shutdown)

Grâce à l'utilisation de `exec` à la fin d'[`entrypoint.sh`](file:///c:/Users/remi2/Documents/GitHub/maps-main/docker/entrypoint.sh), le moteur Go s'exécute avec le PID 1.
Cela permet au conteneur de recevoir directement le signal `SIGTERM` envoyé par `docker stop` et de s'arrêter proprement en moins de 3 secondes (au lieu d'attendre le timeout par défaut de 10 secondes menant à un `SIGKILL`).
