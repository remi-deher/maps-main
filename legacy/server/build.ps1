# --- Build GPS Mock -----------------------------------------------------------

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   GPS Mock - Compilation .exe" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Aller dans le dossier du projet
Set-Location $ScriptDir

# --- Verifications ------------------------------------------------------------

Write-Host "Verifications..." -ForegroundColor Yellow

# Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js n'est pas installe. Installe-le depuis https://nodejs.org" -ForegroundColor Red
    exit 1
}
$nodeVersion = node --version
Write-Host "Node.js $nodeVersion" -ForegroundColor Green

# npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "npm n'est pas disponible." -ForegroundColor Red
    exit 1
}
$npmVersion = npm --version
Write-Host "npm $npmVersion" -ForegroundColor Green

# package.json
if (-not (Test-Path "package.json")) {
    Write-Host "package.json introuvable. Lance ce script depuis le dossier du projet." -ForegroundColor Red
    exit 1
}
Write-Host "package.json trouve" -ForegroundColor Green

Write-Host ""

# --- Python portable ----------------------------------------------------------

$PythonExe = Join-Path $ScriptDir "resources\python\python.exe"

if (-not (Test-Path $PythonExe)) {
    Write-Host "Python portable absent - lancement de setup-python.ps1..." -ForegroundColor Yellow
    Write-Host ""
    & "$ScriptDir\setup-python.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Echec du setup Python (code $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Python portable trouve : resources\python\python.exe" -ForegroundColor Green
    $PmdPath = Join-Path $ScriptDir "resources\python\Lib\site-packages\pymobiledevice3"
    if (Test-Path $PmdPath) {
        Write-Host "pymobiledevice3 present" -ForegroundColor Green
    } else {
        Write-Host "pymobiledevice3 absent - lancement de setup-python.ps1 -Force..." -ForegroundColor Yellow
        & "$ScriptDir\setup-python.ps1" -Force
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Echec du setup Python (code $LASTEXITCODE)" -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host ""

# --- Installation des dependances ---------------------------------------------

Write-Host "Installation des dependances npm..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur lors de npm install" -ForegroundColor Red
    exit 1
}
Write-Host "Dependances installees" -ForegroundColor Green
Write-Host ""

# --- Nettoyage du dossier dist ------------------------------------------------

if (Test-Path "dist") {
    Write-Host "Nettoyage du dossier dist..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "dist"
    Write-Host "dist/ nettoye" -ForegroundColor Green
    Write-Host ""
}

# --- Compilation --------------------------------------------------------------

Write-Host "Compilation en cours..." -ForegroundColor Yellow
Write-Host "(Cela peut prendre 5-10 minutes la premiere fois - Python portable inclus)" -ForegroundColor Gray
Write-Host ""

npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Erreur lors de la compilation." -ForegroundColor Red
    exit 1
}

# --- Resultat -----------------------------------------------------------------

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "   Compilation terminee !" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

# Trouver le .exe genere
$exe = Get-ChildItem -Path "dist" -Filter "*.exe" -Recurse | Select-Object -First 1

if ($exe) {
    $sizeMb = [math]::Round($exe.Length / 1MB, 1)
    Write-Host "Fichier genere :" -ForegroundColor Cyan
    Write-Host "   $($exe.FullName)" -ForegroundColor White
    Write-Host "   Taille : $sizeMb Mo" -ForegroundColor Gray
    Write-Host ""

    # Ouvrir le dossier dist dans l'explorateur
    $response = Read-Host "Ouvrir le dossier dist dans l'explorateur ? (O/n)"
    if ($response -ne 'n' -and $response -ne 'N') {
        Start-Process explorer.exe $exe.DirectoryName
    }
} else {
    Write-Host "  Aucun .exe trouve dans dist/" -ForegroundColor Yellow
}

Write-Host ""