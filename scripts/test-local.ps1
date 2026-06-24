# Local manual-test wrapper: builds the headless engine + the wsclient menu
# tool, launches the engine in its own elevated window (needed for the
# IPv6 tunnel adapter), waits for it to come up, then drops you into the
# wsclient's interactive menu in the current window. No Tauri/Docker build.
#
# Usage:
#   ./scripts/test-local.ps1                       # driver=go-ios, port 8080
#   ./scripts/test-local.ps1 -Driver pymobiledevice
#   ./scripts/test-local.ps1 -Port 8090 -NoTunnel
#
# Run from a normal (non-admin) shell - it elevates the engine window itself.

param(
    [string]$Driver = "go-ios",
    [int]$Port = 8080,
    [switch]$NoTunnel
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$engineDir = Resolve-Path (Join-Path $scriptDir "../engine")

Write-Host "Building gpsmock-engine..." -ForegroundColor Cyan
Push-Location $engineDir
go build -o gpsmock-engine-test.exe ./cmd/headless
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "engine build failed" }

Write-Host "Building wsclient..." -ForegroundColor Cyan
go build -o wsclient-test.exe ./cmd/wsclient
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "wsclient build failed" }
Pop-Location

$enginePath = Join-Path $engineDir "gpsmock-engine-test.exe"
$wsclientPath = Join-Path $engineDir "wsclient-test.exe"

$engineArgs = @("-driver", $Driver, "-addr", ":$Port")
if ($NoTunnel) { $engineArgs += "-no-tunnel" }

Write-Host "Launching engine (elevated window): $enginePath $($engineArgs -join ' ')" -ForegroundColor Cyan
Start-Process -FilePath $enginePath -ArgumentList $engineArgs -Verb RunAs -WorkingDirectory $engineDir

Write-Host "Waiting for the engine to answer on port $Port..." -ForegroundColor Cyan
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
    Write-Host "Engine did not answer on /api/health after 15s - it may still be starting (check its window)." -ForegroundColor Yellow
}

Write-Host "Starting wsclient menu..." -ForegroundColor Green
& $wsclientPath -addr "localhost:$Port"
