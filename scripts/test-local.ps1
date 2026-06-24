# Local manual-test wrapper, all-PowerShell UI. Builds the headless engine +
# a tiny "one command in, one JSON reply out" Go helper (wsclient), launches
# the engine hidden in the background (logging to a file instead of a window),
# then drives everything from a single readable PowerShell menu - no raw JSON
# spam, no extra windows to juggle. No Tauri/Docker build.
#
# Usage:
#   ./scripts/test-local.ps1                       # driver=go-ios, port 8080
#   ./scripts/test-local.ps1 -Driver pymobiledevice
#   ./scripts/test-local.ps1 -Port 8090 -NoTunnel
#
# Run from a normal (non-admin) shell - it elevates the engine process itself.

param(
    [string]$Driver = "go-ios",
    [int]$Port = 8080,
    [switch]$NoTunnel
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$engineDir = Resolve-Path (Join-Path $scriptDir "../engine")
$logPath = Join-Path $engineDir "engine-test.log"

function Stop-AllTestProcesses {
    # The engine runs elevated (-Verb RunAs), so a non-elevated Stop-Process
    # silently fails to touch it (access denied) - kill everything via an
    # elevated taskkill instead. Force-killing gpsmock-engine-test.exe does NOT
    # kill its children (Windows doesn't do that automatically) - ios.exe
    # (go-ios's "ios tunnel start" daemon) survives as an orphan and keeps
    # holding port 28100 forever, breaking every later run (USB AND WiFi)
    # until it's killed explicitly. python.exe is only killed when it's
    # actually running pymobiledevice3, to avoid nuking unrelated Python.
    Start-Process -FilePath "taskkill.exe" -ArgumentList @("/F","/IM","gpsmock-engine-test.exe","/IM","wsclient-test.exe","/IM","ios.exe") -Verb RunAs -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue
    $pmd3 = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*pymobiledevice3*" }
    foreach ($p in $pmd3) {
        Start-Process -FilePath "taskkill.exe" -ArgumentList @("/F","/PID",$p.ProcessId) -Verb RunAs -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue
    }
}

Write-Host "Arret d'une eventuelle instance precedente (moteur + daemons go-ios/pymobiledevice3 orphelins)..." -ForegroundColor Cyan
Stop-AllTestProcesses
Start-Sleep -Milliseconds 500
Remove-Item $logPath -ErrorAction SilentlyContinue

Write-Host "Compilation de gpsmock-engine..." -ForegroundColor Cyan
Push-Location $engineDir
go build -o gpsmock-engine-test.exe ./cmd/headless
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "echec de compilation du moteur" }

Write-Host "Compilation de wsclient..." -ForegroundColor Cyan
go build -o wsclient-test.exe ./cmd/wsclient
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "echec de compilation de wsclient" }
Pop-Location

$enginePath = Join-Path $engineDir "gpsmock-engine-test.exe"
$wsclientPath = Join-Path $engineDir "wsclient-test.exe"

$engineArgs = @("-driver", $Driver, "-addr", ":$Port", "-log-file", $logPath)
if ($NoTunnel) { $engineArgs += "-no-tunnel" }

Write-Host "Lancement du moteur en arriere-plan (fenetre cachee, logs -> $logPath)..." -ForegroundColor Cyan
Start-Process -FilePath $enginePath -ArgumentList $engineArgs -Verb RunAs -WorkingDirectory $engineDir -WindowStyle Hidden

Write-Host "Attente de la reponse du moteur sur le port $Port..." -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 1
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
if (-not $ready) {
    Write-Host "Le moteur ne repond toujours pas apres 15s - regardez $logPath." -ForegroundColor Yellow
} else {
    Write-Host "Moteur pret." -ForegroundColor Green
}

function Invoke-Ws {
    param([string]$Action, [string]$JsonData = $null)
    $wsArgs = @("-addr", "localhost:$Port", $Action)
    if ($JsonData) {
        # Windows PowerShell 5.1 strips the double quotes from a string argument
        # when handing it to a native .exe, so a JSON payload like
        # {"lat":49,...} would reach wsclient as {lat:49,...} — invalid JSON, on
        # which wsclient exits 2 with only a stderr message (swallowed by the
        # 2>$null below), leaving $out empty and every payload action looking
        # like a silent timeout. Escaping each " as \" makes the quotes survive
        # the native-command boundary (Go parses \" back to ").
        $wsArgs += ($JsonData -replace '"', '\"')
    }
    $out = & $wsclientPath @wsArgs 2>$null
    if (-not $out) { return $null }
    try { return ($out | Select-Object -Last 1 | ConvertFrom-Json) } catch { return $null }
}

function Show-Status {
    $r = Invoke-Ws "GET_STATUS"
    if (-not $r) { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red; return }
    $d = $r.data
    Write-Host ""
    Write-Host "Etat            : $($d.state)"
    Write-Host "Tunnel actif    : $($d.tunnelActive)"
    Write-Host "Type connexion  : $($d.connectionType)"
    Write-Host "RSD             : $($d.rsdAddress):$($d.rsdPort)"
    Write-Host "Driver USB      : $($d.usbDriver)"
    Write-Host "Driver WiFi     : $($d.wifiDriver)"
    if ($d.deviceInfo) { Write-Host "Appareil        : $($d.deviceInfo.name) ($($d.deviceInfo.driver))" }
}

function Show-Diagnostics {
    $r = Invoke-Ws "GET_DIAGNOSTICS"
    if (-not $r) { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red; return }
    $d = $r.data
    Write-Host ""
    Write-Host "go-ios          : $($d.goIosPath) -- v$($d.goIosVersion)"
    if ($d.goIosError) { Write-Host "  erreur: $($d.goIosError)" -ForegroundColor Red }
    Write-Host "pymobiledevice3 : $($d.pmd3Path) -- v$($d.pmd3Version)"
    if ($d.pmd3Error) { Write-Host "  erreur: $($d.pmd3Error)" -ForegroundColor Red }
    if ($d.usbDevices) { Write-Host "Appareils USB   : $($d.usbDevices.Count)" }
    if ($d.pairingRecords) { Write-Host "Pairing records : $($d.pairingRecords.Count)" }
    if ($d.unpairedUsbDevices -and $d.unpairedUsbDevices.Count -gt 0) {
        Write-Host "Non pairés      : $($d.unpairedUsbDevices -join ', ')" -ForegroundColor Yellow
        Write-Host "  -> le tunnel WiFi ne marchera pas pour cet appareil tant qu'il n'est" -ForegroundColor Yellow
        Write-Host "     pas pairé en USB (option 13)." -ForegroundColor Yellow
    }
}

function Show-Devices {
    $r = Invoke-Ws "GET_NETWORK_DEVICES"
    if (-not $r) { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red; return }
    $devices = $r.data.devices
    Write-Host ""
    if (-not $devices -or $devices.Count -eq 0) {
        Write-Host "Aucun appareil decouvert." -ForegroundColor Yellow
        if ($r.data.error) { Write-Host "Erreur: $($r.data.error)" -ForegroundColor Red }
        return
    }
    $devices | ForEach-Object { Write-Host "- $($_.udid)  $($_.address):$($_.port)" }
}

function Show-MdnsScan {
    Write-Host "Scan mDNS (_apple-mobdev2._tcp + _remotepairing._tcp + _remoted._tcp, ~5-12s)..." -ForegroundColor Cyan
    Write-Host "(navigue via dns-sd, comme le fait Bonjour - pas une recherche reseau brute)" -ForegroundColor DarkGray
    $r = Invoke-Ws "SCAN_MDNS"
    if (-not $r) { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red; return }
    $devices = $r.data.devices
    Write-Host ""
    if ($r.data.error) { Write-Host "Erreur: $($r.data.error)" -ForegroundColor Red }

    $byService = @{
        "_apple-mobdev2._tcp" = @()
        "_remotepairing._tcp" = @()
        "_remoted._tcp"       = @()
    }
    foreach ($d in $devices) { $byService[$d.service] += $d }

    foreach ($svc in @("_apple-mobdev2._tcp", "_remotepairing._tcp", "_remoted._tcp")) {
        $list = $byService[$svc]
        if ($list.Count -eq 0) {
            Write-Host "$svc : rien" -ForegroundColor Yellow
        } else {
            Write-Host "$svc :" -ForegroundColor Green
            $list | ForEach-Object {
                Write-Host "  - $($_.instance)  host=$($_.hostname) port=$($_.port)"
                if ($_.ipv4) { Write-Host "      IPv4: $($_.ipv4 -join ', ')" }
                if ($_.ipv6) { Write-Host "      IPv6: $($_.ipv6 -join ', ')" }
            }
        }
    }

    if ($byService["_apple-mobdev2._tcp"].Count -gt 0 -and $byService["_remotepairing._tcp"].Count -eq 0) {
        Write-Host ""
        Write-Host "-> mobdev2 repond mais pas _remotepairing._tcp : c'est ce dernier qu'il" -ForegroundColor Yellow
        Write-Host "   faut pour le tunnel RSD WiFi iOS17+. Verifiez sur l'iPhone : Reglages >" -ForegroundColor Yellow
        Write-Host "   Confidentialite et securite > Mode developpeur (active), ET qu'un tunnel" -ForegroundColor Yellow
        Write-Host "   a deja ete demarre avec succes en USB depuis l'activation du mode dev" -ForegroundColor Yellow
        Write-Host "   (cree l'enregistrement RemotePairing necessaire au WiFi)." -ForegroundColor Yellow
    } elseif (-not $devices -or $devices.Count -eq 0) {
        Write-Host "Rien du tout : le scan utilise dns-sd (le service Bonjour de Windows), donc" -ForegroundColor Yellow
        Write-Host "si meme _apple-mobdev2._tcp ne repond pas, ce n'est pas un bug du moteur -" -ForegroundColor Yellow
        Write-Host "verifiez que 'dns-sd -B _apple-mobdev2._tcp' dans un terminal separe ne" -ForegroundColor Yellow
        Write-Host "trouve rien non plus (iPhone hors-ligne, isolation clients WiFi, ou" -ForegroundColor Yellow
        Write-Host "pare-feu bloquant UDP 5353)." -ForegroundColor Yellow
    }
}

function Show-RsdProbe {
    Write-Host "Pas de service mDNS pour le port RemotePairing/RSD - on sonde ~180 ports" -ForegroundColor Cyan
    Write-Host "candidats directement sur l'adresse donnee (option 11 pour avoir les IP)." -ForegroundColor Cyan
    Write-Host "Pour une IPv6 link-local (fe80::...), ajoutez la zone: fe80::xxxx%NomCarte" -ForegroundColor Cyan
    Write-Host "(nom de carte reseau visible via: Get-NetAdapter)" -ForegroundColor Cyan
    $host_ = Read-Host "Adresse (IPv4, IPv6 globale, ou IPv6 link-local%zone)"
    if (-not $host_) { Write-Host "Adresse vide, annule." -ForegroundColor Yellow; return }
    Write-Host "Sondage en cours (~5-10s)..." -ForegroundColor Cyan
    $r = Invoke-Ws "PROBE_RSD_PORTS" (@{ host = $host_ } | ConvertTo-Json -Compress)
    if (-not $r) { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red; return }
    if ($r.data.error) { Write-Host "Erreur: $($r.data.error)" -ForegroundColor Red; return }
    $ports = $r.data.openPorts
    if (-not $ports -or $ports.Count -eq 0) {
        Write-Host "Aucun port ouvert trouve sur $host_." -ForegroundColor Yellow
    } else {
        Write-Host "Port(s) ouvert(s) sur $host_ : $($ports -join ', ')" -ForegroundColor Green
        Write-Host "-> utilisable comme adresse RSD manuelle, ex: [$host_]:$($ports[0])" -ForegroundColor Green
    }
}

function Show-Pair {
    Write-Host "Lancement du pairing USB (driver actif: $Driver)..." -ForegroundColor Cyan
    Write-Host "Branchez l'iPhone en USB, deverrouillez-le, et validez le message" -ForegroundColor Cyan
    Write-Host '"Faire confiance a cet ordinateur ?" qui va s''afficher.' -ForegroundColor Cyan
    $r = Invoke-Ws "PAIR_DEVICE"
    if (-not $r) { Write-Host "Pas de reponse (timeout - prompt non valide a temps ?)." -ForegroundColor Red; return }
    if ($r.data.error) { Write-Host "Erreur: $($r.data.error)" -ForegroundColor Red; return }
    Write-Host "Pairing reussi - le tunnel WiFi devrait maintenant pouvoir s'etablir." -ForegroundColor Green
}

function Show-DeviceInfo {
    $r = Invoke-Ws "GET_DEVICE_INFO"
    if (-not $r) { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red; return }
    Write-Host ""
    $r.data | Format-List | Out-String | Write-Host
}

function Tail-Logs {
    param([int]$Lines = 25)
    if (-not (Test-Path $logPath)) { Write-Host "Pas de fichier de log encore." -ForegroundColor Yellow; return }
    Write-Host ""
    Get-Content $logPath -Tail $Lines
}

function Watch-Logs {
    if (-not (Test-Path $logPath)) { Write-Host "Pas de fichier de log encore." -ForegroundColor Yellow; return }
    Write-Host "Suivi en direct - Ctrl+C pour revenir au menu." -ForegroundColor Cyan
    try { Get-Content $logPath -Tail 10 -Wait } catch {}
}

function Print-Menu {
    Write-Host ""
    Write-Host "=== gpsmock - test local ($Driver, port $Port) ===" -ForegroundColor Cyan
    Write-Host " 1) Statut"
    Write-Host " 2) Diagnostics (versions go-ios / pymobiledevice3)"
    Write-Host " 3) Appareils decouverts (mDNS / tunnel)"
    Write-Host " 4) Infos appareil actif"
    Write-Host " 5) Changer de driver"
    Write-Host " 6) Definir une position"
    Write-Host " 7) Effacer la position"
    Write-Host " 8) Heartbeat"
    Write-Host " 9) Voir les derniers logs"
    Write-Host "10) Suivre les logs en direct (Ctrl+C pour revenir)"
    Write-Host "11) Scanner mDNS direct (_apple-mobdev2._tcp / *.mobdev2.local)"
    Write-Host "12) Sonder les ports RSD/RemotePairing sur une adresse"
    Write-Host "13) Pairer l'iPhone (USB - prompt 'Faire confiance')"
    Write-Host " 0) Quitter (arrete aussi le moteur)"
}

Print-Menu
while ($true) {
    Write-Host ""
    $choice = Read-Host "Choix"
    switch ($choice) {
        "1" { Show-Status }
        "2" { Show-Diagnostics }
        "3" { Show-Devices }
        "4" { Show-DeviceInfo }
        "5" {
            $driverId = Read-Host "Driver (go-ios|pymobiledevice)"
            $transport = Read-Host "Transport (auto|usb|wifi, vide=auto)"
            $payload = @{ driverId = $driverId }
            if ($transport) { $payload.transport = $transport }
            $r = Invoke-Ws "SWITCH_DRIVER" ($payload | ConvertTo-Json -Compress)
            if ($r) { Write-Host "OK -> etat: $($r.data.state), tunnel actif: $($r.data.tunnelActive)" -ForegroundColor Green } else { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red }
        }
        "6" {
            $lat = Read-Host "Latitude"
            $lon = Read-Host "Longitude"
            $name = Read-Host "Nom (optionnel)"
            $payload = @{ lat = [double]$lat; lon = [double]$lon }
            if ($name) { $payload.name = $name }
            $r = Invoke-Ws "SET_LOCATION" ($payload | ConvertTo-Json -Compress)
            if ($r) { Write-Host "OK." -ForegroundColor Green } else { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red }
        }
        "7" {
            $r = Invoke-Ws "CLEAR_LOCATION"
            if ($r) { Write-Host "OK." -ForegroundColor Green } else { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red }
        }
        "8" {
            $r = Invoke-Ws "HEARTBEAT"
            if ($r) { Write-Host "Pong recu." -ForegroundColor Green } else { Write-Host "Pas de reponse (timeout)." -ForegroundColor Red }
        }
        "9" { Tail-Logs }
        "10" { Watch-Logs }
        "11" { Show-MdnsScan }
        "12" { Show-RsdProbe }
        "13" { Show-Pair }
        "0" {
            Write-Host "Arret du moteur et de ses daemons..." -ForegroundColor Cyan
            Stop-AllTestProcesses
            break
        }
        default { Write-Host "Choix invalide." -ForegroundColor Yellow }
    }
    if ($choice -eq "0") { break }
    Print-Menu
}
