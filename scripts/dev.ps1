# Get the root directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$rootDir = Resolve-Path (Join-Path $scriptDir "..")
$tauriAppDir = Join-Path $rootDir "tauri-app"

# 1. Build sidecar first
Write-Host "Checking/Building Tauri sidecar..." -ForegroundColor Cyan
& (Join-Path $scriptDir "build-sidecar.ps1")

# 2. Run Tauri dev
Write-Host "Starting Tauri application in dev mode..." -ForegroundColor Cyan
Push-Location $tauriAppDir
npm run tauri dev
Pop-Location
