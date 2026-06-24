# Pairing & tunnel iOS 17+ — comment ça marche vraiment

Note technique issue d'une session de debug réelle (2026-06-24) : un iPhone
détecté en USB mais dont le tunnel WiFi RSD ne montait jamais, alors que
`SET_LOCATION` fonctionnait parfaitement en CLI manuelle sur la même adresse.
La cause n'était ni go-ios, ni pymobiledevice3, ni le moteur — c'était un
enregistrement de confiance USB jamais créé. Ce document explique le
mécanisme pour que la prochaine personne (humaine ou IA) comprenne le
problème en quelques minutes plutôt qu'en plusieurs heures.

## Deux pairings différents, faciles à confondre

iOS distingue deux notions de "pairing", empilées l'une sur l'autre. Le
moteur (et la plupart de la doc go-ios/pymobiledevice3) ne les nomme pas
toujours clairement, d'où la confusion.

```
┌─────────────────────────────────────────────────────────────┐
│ 1. LOCKDOWN PAIRING (trust USB)                              │
│    "Faire confiance à cet ordinateur ?" sur l'iPhone          │
│    → crée un certificat client + une clé hôte                │
│    → stocké en .plist dans un dossier SYSTÈME partagé        │
└───────────────────────┬───────────────────────────────────────┘
                         │ prérequis obligatoire
┌────────────────────────▼──────────────────────────────────────┐
│ 2. REMOTEPAIRING / RSD (tunnel WiFi iOS17+)                    │
│    Négocié automatiquement par `ios tunnel start` ou           │
│    `pymobiledevice3 remote tunneld`, MAIS seulement si le       │
│    Lockdown pairing (étape 1) existe déjà pour cet UDID         │
│    → ouvre l'interface tunnel virtuelle (adresse IPv6 ULA)      │
└──────────────────────────────────────────────────────────────┘
```

**Le point clé :** sans l'étape 1 (faite au moins une fois, en USB, avec
validation du prompt sur l'écran de l'iPhone), l'étape 2 ne peut jamais
réussir — ni en USB, ni en WiFi. Le tunnel WiFi RSD a beau ne rien avoir à
voir avec le câble, il a besoin d'un certificat dont la *création* exige
le câble (Apple ne permet pas d'initier ce trust autrement, par design
sécurité — n'importe qui sur le WiFi pourrait sinon usurper la confiance).

## Où c'est stocké, et pourquoi go-ios ET pymobiledevice3 se débloquent ensemble

Les deux outils lisent/écrivent le **même dossier système Lockdown** :

| OS | Dossier |
| --- | --- |
| Windows | `%ProgramData%\Apple\Lockdown\<UDID>.plist` |
| Linux | `/var/lib/lockdown/<UDID>.plist` |
| macOS | `/var/db/lockdown/<UDID>.plist` |

Un seul `ios pair` (ou `pymobiledevice3 lockdown pair`) écrit ce fichier une
fois pour toutes pour cet UDID. Comme **les deux** CLI lisent ce même
fichier, un pairing fait avec l'un débloque immédiatement l'autre — ce qui
explique pourquoi, dans la session de debug, basculer entre `go-ios` et
`pymobiledevice` n'avait aucun effet sur le symptôme : le blocage était en
amont des deux drivers, au niveau du système de fichiers partagé, pas dans
le code de l'un ou l'autre.

Le moteur connaît déjà ce dossier (`internal/platform/binary.go:LockdownDir`)
et le passe explicitement à go-ios via `--pair-record-path`
([goios.go:43](../engine/internal/driver/goios/goios.go:43)).
pymobiledevice3 le lit nativement sans qu'on ait besoin de le lui préciser.

## Comment le diagnostiquer (et où le moteur le voit déjà)

`GetDiagnostics()` ([engine_diagnostics.go:76](../engine/internal/engine/engine_diagnostics.go:76))
parcourt ce dossier et expose chaque `.plist` trouvé sous forme
`PairingRecord{UDID, DeviceName, ModTime}` — visible via l'option 2 du
script de test (`Pairing records : N`). **Un compteur à 0 (ou un UDID ciblé
absent de la liste) est le signal univoque** : le tunnel WiFi ne pourra
jamais monter pour ce device tant qu'un pairing USB n'a pas été fait.

C'est une information que le moteur collecte déjà mais ne relie pas
automatiquement à un échec de tunnel — voir pistes d'amélioration
ci-dessous.

## Commandes CLI équivalentes par outil

### go-ios

```powershell
ios pair --udid=<udid>                          # crée le trust (prompt sur l'iPhone, USB requis)
ios readpair --udid=<udid>                       # vérifie qu'un enregistrement existe déjà
ios devmode get --udid=<udid>                    # état du Mode Développeur
ios devmode enable --udid=<udid>                 # l'active (redémarre le téléphone)
ios tunnel start --tunnel-info-port=28100        # monte le tunnel RSD ; pair automatiquement si besoin
```

### pymobiledevice3

```powershell
python -m pymobiledevice3 lockdown pair --udid <udid>       # crée le trust (prompt sur l'iPhone, USB requis)
python -m pymobiledevice3 remote pair                         # RemotePairing RSD explicite (iOS17+)
python -m pymobiledevice3 remote tunneld                      # daemon tunnel ; pair automatiquement si besoin
python -m pymobiledevice3 lockdown save-pair-record <chemin>  # exporte l'enregistrement (ex: pour le cluster)
```

## Pourquoi le symptôme trompait autant

Trois éléments combinés rendaient le diagnostic difficile :

1. **Le statut affichait "Tunnel actif: True"** même quand le tunnel WiFi
   était en réalité instable/mort — parce que le tunnel se montait bien
   *brièvement* dès qu'un device USB répondait, créant un faux sentiment
   que "ça marche", avant de retomber.
2. **`ios setlocation`/le worker pymobiledevice3 fonctionnaient en CLI
   manuelle** avec la même adresse RSD que le moteur — preuve que l'adresse
   était valide à l'instant T, ce qui détournait l'enquête vers
   l'orchestration Go plutôt que vers le pairing lui-même.
3. **Aucun message d'erreur explicite** ne pointait vers "pairing Lockdown
   manquant" : l'échec se manifestait comme un timeout générique côté
   client (lui-même causé par un bug de quoting PowerShell sans rapport,
   voir [scripts/SCRIPTING_PITFALLS.md](../scripts/SCRIPTING_PITFALLS.md)),
   ce qui a fait perdre du temps sur une fausse piste avant de revenir au
   pairing.

La leçon : quand un tunnel WiFi iOS 17+ refuse de tenir alors que l'USB
fonctionne, **vérifier le pairing Lockdown avant tout le reste** — c'est la
cause la plus fréquente et la plus simple à corriger (un seul `ios pair`),
bien avant d'aller chercher des bugs de driver ou de réseau.
