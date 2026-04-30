# GPS Mock - Universal Manager (Windows)
# Version 2.2.0

$ErrorActionPreference = "Stop"

# --- 1. Check for Admin Privileges ---
function Check-Admin {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "🚨 Ce script nécessite les droits d'ADMINISTRATEUR." -ForegroundColor Red
        Write-Host "Relance en cours avec privilèges élevés..." -ForegroundColor Yellow
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
        exit
    }
}

# --- 2. Configuration & Paths ---
$RootDir = Get-Location
$ServerDir = Join-Path $RootDir "server"
$SettingsPath = Join-Path $ServerDir "src/main/core/storage/settings.json" # Adapté au PathResolver

function Get-Mode {
    if (Test-Path $SettingsPath) {
        $json = Get-Content $SettingsPath | ConvertFrom-Json
        return if ($json.manualTunnelMode) { "HEADLESS" } else { "AUTO/GUI" }
    }
    return "NON CONFIGURÉ"
}

# --- 3. Menu Logic ---
function Show-Menu {
    Clear-Host
    $Mode = Get-Mode
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "      📍 GPS MOCK - MANAGER V2 (Win)" -ForegroundColor White
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host " État Service : " -NoNewline; Check-ServiceStatus
    Write-Host " Mode Actuel  : $Mode" -ForegroundColor Gray
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host " 1) 🛠️  Installation / Réparation"
    Write-Host " 2) 🚀  Démarrer le Service (Headless)"
    Write-Host " 3) 🖥️  Lancer l'Interface (GUI)"
    Write-Host " 4) 🛑  Arrêter tout (Service & App)"
    Write-Host " 5) 📜  Voir les Logs (PM2)"
    Write-Host " 6) 🔍  Diagnostic iPhone"
    Write-Host " 7) 🔄  Mise à jour (Git Pull)"
    Write-Host " 0) ❌  Quitter"
    Write-Host "=========================================" -ForegroundColor Cyan
}

function Check-ServiceStatus {
    $pm2Check = Get-Command pm2 -ErrorAction SilentlyContinue
    if ($pm2Check) {
        $status = pm2 jlist | ConvertFrom-Json
        $app = $status | Where-Object { $_.name -eq "gps-mock-server" }
        if ($app -and $app.pm2_env.status -eq "online") {
            Write-Host "ACTIF (PM2)" -ForegroundColor Green
        } else {
            Write-Host "INACTIF" -ForegroundColor Red
        }
    } else {
        Write-Host "INACTIF (PM2 non installé)" -ForegroundColor Gray
    }
}

# --- 4. Actions ---

function Action-Install {
    Write-Host "`n[1/3] Vérification des dépendances Node.js..." -ForegroundColor Yellow
    Set-Location $ServerDir
    npm install
    
    Write-Host "[2/3] Installation de PM2 pour le mode service..." -ForegroundColor Yellow
    npm install -g pm2 pm2-windows-service
    
    Write-Host "[3/3] Configuration du démarrage automatique..." -ForegroundColor Yellow
    # Optionnel: on pourrait enregistrer le service ici
    
    Write-Host "`n✅ Installation terminée !" -ForegroundColor Green
    Pause
}

function Action-StartHeadless {
    Write-Host "`n🚀 Démarrage du serveur en mode Headless..." -ForegroundColor Cyan
    Set-Location $ServerDir
    pm2 start headless-entry.js --name "gps-mock-server" --update-env
    pm2 save
    Write-Host "✅ Serveur démarré via PM2." -ForegroundColor Green
    Pause
}

function Action-StartGUI {
    Write-Host "`n🖥️ Lancement de l'interface graphique..." -ForegroundColor Cyan
    Set-Location $ServerDir
    npm start
}

function Action-Stop {
    Write-Host "`n🛑 Arrêt des services..." -ForegroundColor Yellow
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
    $pm2Check = Get-Command pm2 -ErrorAction SilentlyContinue
    if ($pm2Check) { pm2 stop gps-mock-server }
    Write-Host "✅ Arrêt terminé." -ForegroundColor Green
    Pause
}

function Action-Logs {
    Write-Host "`n📜 Affichage des logs (Ctrl+C pour quitter)..." -ForegroundColor Cyan
    pm2 logs gps-mock-server
}

function Action-Diag {
    Write-Host "`n🔍 Lancement du diagnostic..." -ForegroundColor Cyan
    Set-Location $ServerDir
    node -e "require('./src/main/platform/BinaryManager').getSpawnArgs('pmd3', ['usbmux', 'list'])" # Exemple simple
    Write-Host "`n--- Liste USB ---"
    & (node -e "console.log(require('./src/main/platform/BinaryManager').getSpawnArgs('pmd3', []).exe)") usbmux list
    Pause
}

function Action-Update {
    Write-Host "`n🔄 Récupération de la dernière version..." -ForegroundColor Cyan
    Set-Location $RootDir
    git pull
    Set-Location $ServerDir
    npm install
    Write-Host "✅ Mise à jour terminée." -ForegroundColor Green
    Pause
}

# --- Main Loop ---
Check-Admin

while ($true) {
    Show-Menu
    $choice = Read-Host "Choisissez une option [0-7]"
    
    switch ($choice) {
        "1" { Action-Install }
        "2" { Action-StartHeadless }
        "3" { Action-StartGUI }
        "4" { Action-Stop }
        "5" { Action-Logs }
        "6" { Action-Diag }
        "7" { Action-Update }
        "0" { exit }
        default { Write-Host "Option invalide." -ForegroundColor Red; Start-Sleep -Seconds 1 }
    }
}
