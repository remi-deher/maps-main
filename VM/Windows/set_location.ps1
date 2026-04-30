# set_location.ps1 - Quick GPS Command for Windows VM
# Usage: .\set_location.ps1 -lat 48.8566 -lon 2.3522

param(
    [Parameter(Mandatory=$true)]
    [double]$lat,
    [Parameter(Mandatory=$true)]
    [double]$lon
)

$jsonPath = Join-Path $PSScriptRoot "tunnel_state.json"

if (-not (Test-Path $jsonPath)) {
    Write-Error "Tunnel data not found. Please run start_bridge.ps1 first."
    exit 1
}

try {
    $data = Get-Content $jsonPath | ConvertFrom-Json
} catch {
    Write-Error "Failed to read tunnel_data.json. It might be corrupted."
    exit 1
}

Write-Host "[*] Setting location to: $lat, $lon" -ForegroundColor Cyan
Write-Host "[*] Using RSD Address: $($data.address) Port: $($data.port)" -ForegroundColor Gray

# IPv6 addresses must be quoted. Pymobiledevice3 expects the RSD address and port.
# The user specified: pymobiledevice3 developer dvt simulate-location set --rsd "[ADDR]" [PORT] -- [LAT] [LON]

$addr = $data.address
$port = $data.port

# Note: In PowerShell, we pass the arguments to the native command.
# IPv6 addresses with brackets are often required for tools.
python -m pymobiledevice3 developer dvt simulate-location set --rsd "$addr" $port -- $lat $lon

if ($LASTEXITCODE -eq 0) {
    Write-Host "[+] Location updated successfully!" -ForegroundColor Green
} else {
    Write-Error "Failed to set location. Check if the tunnel is still active."
}
