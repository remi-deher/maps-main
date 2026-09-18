# Driver `go-ios-native` (in-process)

Troisième backend, **optionnel**, compilé uniquement avec le build tag
`goiosnative`. Il pilote go-ios **en tant que bibliothèque Go** au lieu de
lancer son exécutable.

> **Statut : non validé sur appareil réel.** Le code compile, les contrats
> d'interface sont couverts par des tests, mais aucune injection n'a encore été
> faite sur un iPhone. Ne pas en faire le driver par défaut avant cette
> validation.

---

## Pourquoi

Le driver `go-ios` existant lance **un processus `ios setlocation` par point
injecté**. Une route joue à 1 Hz : c'est donc, chaque seconde, une création de
processus, une connexion RSD et une poignée de main RSD complète. Sur Windows
c'est le coût dominant de la lecture d'un tracé.

En bibliothèque :

| | `go-ios` (CLI) | `go-ios-native` |
|---|---|---|
| Injection d'un point | 1 processus + handshake RSD | 1 message DVT |
| Handle appareil | reconstruit à chaque commande | construit une fois, réutilisé |
| Démon tunnel | processus `ios tunnel start` | goroutine in-process |
| Port d'API local | 28100 (partagé, à coordonner) | aucun |
| Orphelins à l'arrêt | possibles (d'où `killTree`) | aucun |
| Parsing | sortie CLI, sujette aux évolutions | types Go |

## Ce que ça coûte

`github.com/danielpaulus/go-ios` amène gvisor, quic-go, gopacket, netlink,
wintun et `songgao/water`. Mesuré sur ce dépôt (`-trimpath -ldflags="-s -w"`,
windows/amd64) :

| Build | Taille |
|---|---|
| défaut | 12,5 Mo |
| `-tags goiosnative` | 16,7 Mo |

Soit **+4,2 Mo (+34 %)**. C'est la raison du build tag : le binaire par défaut,
y compris le side-car Tauri, ne lie rien de tout ça. Le module apparaît en
revanche dans `go.mod` pour tout le monde — la CI télécharge les dépendances et
les scanners les voient, même non liées.

## Utilisation

```bash
cd engine
go build -tags goiosnative ./cmd/headless
./headless -driver go-ios-native
```

Sans le tag, `go-ios-native` n'est simplement pas dans le menu des drivers :
rien ne s'enregistre, `driver.Available()` ne le liste pas.

## Comment c'est construit

- `internal/driver/goiosnative/goiosnative.go` — struct, enregistrement,
  `ListDevices`, `CheckHealth`.
- `tunnel.go` — `TunnelManager` in-process, boucle `UpdateTunnels` à 1 Hz (ce
  que fait l'agent go-ios lui-même), attente kernel-TUN puis repli userspace,
  `ReresolveTunnel`, `ListNetworkDevices`.
- `location.go` — handle appareil (connexion RSD + `Handshake` +
  `GetDeviceWithAddress`) mis en cache et invalidé quand l'endpoint bouge ou
  qu'une opération DVT échoue ; injection via `simlocation`.
- `absent.go` — coquille vide hors tag, pour que `go build ./...` ne casse pas.

Les règles héritées des drivers CLI sont conservées telles quelles :

- **Repli userspace** : kernel-TUN d'abord (rapide, demande les droits admin),
  puis `userspaceTUN=true`. Un contexte annulé n'entraîne jamais de seconde
  tentative — voir `driver.StartBudget` pour le budget que l'appelant doit
  accorder.
- **Sonde de santé** : en userspace il n'y a pas d'adaptateur TUN, donc pas de
  route vers l'adresse de l'appareil ; on compose `127.0.0.1:<userspacePort>`.
- **Suivi par UDID** : `ReresolveTunnel` suit l'appareil entre USB et WiFi sans
  reconstruire le manager, et ne signale `daemonAlive=false` que s'il n'y a plus
  de manager du tout.

## Ce qui manque encore

- `Pairer` — la CLI expose `ios pair` ; l'équivalent bibliothèque n'est pas
  branché, donc l'action `PAIR_DEVICE` reste à faire via un driver CLI.
- `DeviceStateProbe` — pas de mode développeur ni d'état DDI remontés, donc le
  rapport de pré-vol affichera « inconnu » pour ces deux prérequis.
- `DeviceInfoProvider` — `GET_DEVICE_INFO` ne renvoie rien sur ce backend.
- **Montage du DDI** — non effectué. Sur un appareil où l'image n'a jamais été
  montée, l'injection échouera sur un service DVT absent. En attendant, faire un
  premier démarrage avec le driver `go-ios` ou `pymobiledevice` (tous deux
  montent l'image) suffit : l'état est côté appareil.

## Validation attendue sur appareil

1. iPhone branché en USB, déverrouillé, approuvé, mode développeur actif.
2. Un démarrage avec le driver `go-ios` pour monter le DDI.
3. `-driver go-ios-native` : le tunnel monte, `GET /api/status` expose une
   adresse RSD.
4. Téléportation simple, puis lecture d'une route : vérifier la fluidité à 1 Hz
   et `gpsmock_injection_failures_total` à zéro sur `/metrics`.
5. Débrancher l'USB en cours de route : le suivi USB→WiFi doit se faire sans
   redémarrage du tunnel (`gpsmock_tunnel_reresolves_total` s'incrémente,
   `gpsmock_tunnel_restarts_total` non).
6. Sans droits administrateur : vérifier que le repli userspace se produit et
   que l'injection fonctionne quand même.
