# Scripts — installation & gestion du moteur headless

Installe et pilote le moteur `headless` en **service système**.

| OS | Script | Mécanisme |
| --- | --- | --- |
| Linux | [`linux/gpsmock-ctl.sh`](linux/gpsmock-ctl.sh) | service **systemd** (`gpsmock.service`) |
| Windows | [`windows/gpsmock-ctl.ps1`](windows/gpsmock-ctl.ps1) | **service Windows** (SCM) |
| macOS | [`macos/gpsmock-ctl.sh`](macos/gpsmock-ctl.sh) | **daemon launchd** (`com.remi2.gpsmock`) |

Les trois exposent les mêmes verbes : `install`, `uninstall`, `start`, `stop`,
`restart`, `status`, `logs`, `config`.

## Linux (systemd)

```bash
# Installer + démarrer (root requis). Build le binaire si Go est présent.
sudo scripts/linux/gpsmock-ctl.sh install --driver go-ios --transport usb --addr :8080

# Gérer
sudo scripts/linux/gpsmock-ctl.sh start|stop|restart
scripts/linux/gpsmock-ctl.sh status
scripts/linux/gpsmock-ctl.sh logs        # journalctl -f
scripts/linux/gpsmock-ctl.sh config      # affiche /etc/gpsmock/gpsmock.env

sudo scripts/linux/gpsmock-ctl.sh uninstall
```

Reconfiguration : éditer `/etc/gpsmock/gpsmock.env` puis
`sudo systemctl restart gpsmock`. Les drivers USB (go-ios / pymobiledevice3)
nécessitent en général root + `usbmuxd`.

## Windows (service)

Ouvrir un **PowerShell Administrateur** :

```powershell
# Installer + démarrer (build le binaire si Go est présent)
.\scripts\windows\gpsmock-ctl.ps1 install -Driver pymobiledevice -Transport usb -Addr ':8080'

# Gérer
.\scripts\windows\gpsmock-ctl.ps1 start|stop|restart|status
.\scripts\windows\gpsmock-ctl.ps1 logs      # suit %ProgramData%\gpsmock\logs\engine.log
.\scripts\windows\gpsmock-ctl.ps1 config
.\scripts\windows\gpsmock-ctl.ps1 uninstall
```

Reconfiguration : relancer `install` avec les nouveaux paramètres (recrée le
service). Le binaire et les logs vivent sous `%ProgramData%\gpsmock\`.

## macOS (launchd)

```bash
# Installer + démarrer (root requis). Build le binaire si Go est présent.
sudo scripts/macos/gpsmock-ctl.sh install --driver go-ios --transport usb --addr :8080

# Gérer
sudo scripts/macos/gpsmock-ctl.sh start|stop|restart
scripts/macos/gpsmock-ctl.sh status
scripts/macos/gpsmock-ctl.sh logs        # tail -f /var/log/gpsmock/engine.log
scripts/macos/gpsmock-ctl.sh config      # affiche /etc/gpsmock/gpsmock.env

sudo scripts/macos/gpsmock-ctl.sh uninstall
```

Reconfiguration : relancer `install` avec les nouveaux paramètres (recrée le
plist `/Library/LaunchDaemons/com.remi2.gpsmock.plist`). Le binaire vit en
`/usr/local/bin/gpsmock-engine`, les logs en `/var/log/gpsmock/engine.log`.
Tourne en tant que daemon système (`system/` domain), pas en LaunchAgent par
session — il démarre donc avant toute connexion utilisateur.

## Configuration

| Flag (install) | Variable d'env (Linux/macOS) | Défaut |
| --- | --- | --- |
| `--driver` / `-Driver` | `GPSMOCK_DRIVER` | `pymobiledevice` |
| `--transport` / `-Transport` | `GPSMOCK_TRANSPORT` | `auto` |
| `--addr` / `-Addr` | `GPSMOCK_ADDR` | `:8080` |
| `--rsd` / `-Rsd` | `GPSMOCK_RSD` | _(vide)_ |
| `--goios-bin` / `-GoiosBin` | `GPSMOCK_GOIOS_BIN` | _(auto)_ |
| `--python-bin` / `-PythonBin` | `GPSMOCK_PYTHON_BIN` | _(auto)_ |

Le binaire `headless` accepte aussi ces variables `GPSMOCK_*` directement (les
flags l'emportent), ce qui permet de le piloter sans service.
