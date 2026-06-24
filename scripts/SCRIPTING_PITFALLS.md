# Pièges des scripts multi-OS — leçons de ce repo

Notes pratiques pour écrire/modifier les scripts de `scripts/` (PowerShell,
Bash, et la frontière entre les deux) sans retomber dans les pièges déjà
rencontrés ici. Chaque section part d'un bug réel.

## PowerShell (Windows)

### 1. Les guillemets disparaissent en appelant un .exe natif

**Le bug réel (2026-06-24) :** `test-local.ps1` construisait un payload JSON
avec `ConvertTo-Json` puis le passait à `wsclient-test.exe` via
`& $exe @args`. PowerShell 5.1 **supprime les guillemets doubles** d'un
argument string quand il est transmis à un exécutable natif :

```powershell
$payload = '{"lat":49,"lon":2}'
& monexe.exe $payload
# monexe.exe reçoit littéralement : {lat:49,lon:2}   <- JSON invalide
```

Résultat : `wsclient` faisait `os.Exit(2)` avec un message d'erreur sur
**stderr seulement**, qui était avalé par un `2>$null` plus haut dans le
script. Stdout vide → le script affichait "timeout" pour une action qui
n'avait **jamais atteint le serveur**. Repéré uniquement via un dump complet
des goroutines côté Go montrant le process serveur totalement au repos.

**Règle :** tout argument string contenant des `"` et destiné à un binaire
natif (pas une autre commande PowerShell) doit être échappé avant l'appel :

```powershell
$safe = $payload -replace '"', '\"'
& monexe.exe $safe
```

`\"` survit à la frontière PowerShell→natif et la plupart des parseurs
d'arguments (Go `CommandLineToArgvW`, C `argv`, etc.) le reconvertissent
correctement en `"`.

**Pour vérifier qu'un appel natif reçoit bien le bon argument**, sans
deviner : faites échouer l'appel délibérément (mauvais port, etc.) et
inspectez le code de sortie/stderr — un "JSON invalide" prouve que
l'argument est mutilé *avant même* la tentative réseau.

### 2. `2>$null` / `-ErrorAction SilentlyContinue` cachent la vraie cause

Avaler stderr est tentant pour garder une sortie propre, mais ça transforme
toute erreur silencieuse en "pas de réponse" générique. Préférez capturer
stderr dans une variable (`2>&1` puis filtrer) plutôt que de le jeter, au
moins pendant le développement — ou loggez-le dans un fichier de diagnostic.

### 3. `-Verb RunAs` élève le process, pas forcément son PATH

Un process lancé avec `Start-Process -Verb RunAs` hérite de l'élévation,
mais un PATH utilisateur (pyenv, installs `--user`, Microsoft Store) peut
différer entre un shell normal et un shell admin. Si un sous-processus
(`python`, `ios.exe`...) se comporte différemment une fois élevé, comparez
`$env:PATH` dans les deux contextes avant de chercher plus loin.

### 4. PowerShell n'a pas `&&` / `||`

`commande1 && commande2` est une erreur de syntaxe en PowerShell 5.1 (ça
existe seulement depuis PS 7+, et ce repo cible aussi PS 5.1/Windows par
défaut). Utiliser :

```powershell
commande1
if ($?) { commande2 }
```

### 5. Tuer un process élevé depuis un shell non-élevé échoue silencieusement

`Stop-Process` sur un PID lancé avec `-Verb RunAs` échoue avec "accès
refusé" si le shell appelant n'est pas lui-même élevé. Ce repo contourne ça
en passant par un `taskkill.exe` lui-même lancé avec `-Verb RunAs` (voir
`Stop-AllTestProcesses` dans `test-local.ps1`).

### 6. Tuer le process parent ne tue pas ses enfants

Sur Windows, terminer un process ne termine pas automatiquement ses
processus enfants (contrairement à un `kill` de groupe sur Unix). Un daemon
qui spawn un sous-process (`ios tunnel start` lancé par le moteur, par
exemple) laisse un orphelin qui continue à tenir un port/une ressource. Ce
repo utilise `CREATE_NEW_PROCESS_GROUP` à la création + `taskkill /T /F`
pour tuer l'arbre entier (voir `internal/driver/process_kill_windows.go`).

## Bash (Linux/macOS)

### 1. Toujours quoter les variables

`rm -rf $dir` casse si `$dir` est vide (`rm -rf` sur le répertoire courant
implicite des arguments restants) ou contient un espace. Toujours
`"$dir"`. Activer `set -euo pipefail` en tête de script pour qu'une variable
non définie ou une commande qui échoue arrête le script au lieu de
continuer dans un état incohérent.

### 2. `sudo` change `$HOME` et le PATH

Un script qui fait `sudo ./install.sh` peut voir un PATH différent (pas de
pyenv/asdf utilisateur) et `$HOME=/root` au lieu du home de l'utilisateur
réel. Si le script doit lire une config utilisateur, utiliser
`$SUDO_USER` pour retrouver le bon home plutôt que `$HOME`.

### 3. macOS `bash` est vieux (3.2), pas le bash de Linux

macOS embarque encore Bash 3.2 (licence GPLv2) — pas d'`associative
arrays` (`declare -A`), pas de `${var,,}` (lowercase). Si un script doit
tourner identiquement sur Linux et macOS sans dépendance à un Bash installé
via Homebrew, rester sur de la syntaxe POSIX/Bash 3 compatible, ou shebang
explicite vers `#!/usr/bin/env bash` et documenter le besoin de
`brew install bash`.

### 4. `systemd` vs `launchd` : pas la même notion de "service"

Les scripts `linux/gpsmock-ctl.sh` et `macos/gpsmock-ctl.sh` de ce repo
partagent la même interface (`install/start/stop/status/logs`) mais des
mécanismes très différents en dessous — un daemon `launchd` système
(`/Library/LaunchDaemons`) démarre avant toute session utilisateur, alors
qu'un `LaunchAgent` ne démarre qu'après connexion. Ne pas mélanger les deux
domaines (`system/` vs `gui/<uid>/`) sans le vouloir explicitement.

## Frontière PowerShell ↔ Bash (scripts miroir, ex. `dev.ps1`/`dev.sh`)

### 1. Les chemins ne se comportent pas pareil

`\` est un séparateur de chemin sur Windows mais un caractère d'échappement
en Bash. Toute valeur passée d'un monde à l'autre (chemin codé en dur dans
un message d'erreur, par exemple) doit être normalisée en `/` avant d'être
réutilisée côté Bash, ou laissée intacte et seulement affichée.

### 2. Les fins de ligne (CRLF vs LF) cassent les scripts Bash édités sous Windows

Un script `.sh` sauvegardé avec des fins de ligne CRLF (éditeur Windows par
défaut) échoue à l'exécution sur Linux/macOS avec une erreur cryptique
(`$'\r': command not found` ou pire, un shebang invalide si le `\r` traîne
juste après `#!/usr/bin/env bash`). Vérifier `.gitattributes` force les
`.sh` en LF, ou exécuter `dos2unix`/`git config core.autocrlf` correctement
configuré avant de committer.

### 3. Une même commande CLI peut avoir des flags différents par OS

Exemple concret de ce repo : `taskkill` (Windows) vs `kill`/process groups
(Unix) n'ont pas la même grammaire pour "tuer un arbre de processus". Ne pas
chercher de commande unique cross-OS — encapsuler la différence dans une
fonction par OS (`killProcess` dans ce repo a un fichier `_windows.go` et un
fichier `_unix.go` avec la même signature).

## Méthode de débogage générale (la leçon la plus importante)

Quand un script "timeout" ou "ne répond pas" alors que la même action
fonctionne en manuel : **ne pas supposer que le serveur/process cible est en
cause**. Vérifier d'abord ce qui *arrive réellement* à la frontière entre le
script et le process appelé :

1. Reproduire l'appel natif isolément, en dehors du script, avec les mêmes
   arguments — si possible en forçant un échec rapide (mauvais port, mauvaise
   adresse) pour voir l'erreur immédiatement plutôt que d'attendre un vrai
   timeout.
2. Ne jamais avaler stderr par défaut pendant un diagnostic
   (`2>$null` / `2>/dev/null` doivent être retirés temporairement).
3. Si le process cible expose un état interne (ici : un buffer de logs
   interne via WebSocket, distinct du fichier de log), l'interroger
   directement plutôt que de se fier au fichier de log — un événement peut
   être loggé sur un canal que le wrapper du script ne lit jamais.
4. En dernier recours côté Go : un dump de goroutines
   (`net/http/pprof`, `goroutine?debug=2`) tranche définitivement entre "le
   serveur est bloqué quelque part" et "le serveur n'a jamais reçu la
   requête". Un serveur sain et au repos au moment du blocage signifie que
   le bug est dans la couche client/transport, pas dans la logique métier.
