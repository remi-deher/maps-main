# Start-Bridge.ps1 - Orchestrator for RSD Tunnel on Windows VM
# Requirements: pymobiledevice3, Bonjour Service, Administrator Privileges

# 1. Verification of Administrator Privileges
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

# 2. Check Bonjour Service
$bonjour = Get-Service -Name "Bonjour Service" -ErrorAction SilentlyContinue
if ($null -eq $bonjour -or $bonjour.Status -ne 'Running') {
    Write-Host "[!] Bonjour Service is not running. Attempting to start..." -ForegroundColor Yellow
    try {
        Start-Service -Name "Bonjour Service" -ErrorAction Stop
        Write-Host "[+] Bonjour Service started successfully." -ForegroundColor Green
    } catch {
        Write-Error "Failed to start Bonjour Service. Please ensure it is installed."
        exit 1
    }
}

# 3. Mount DDI
Write-Host "[*] Mounting DDI..." -ForegroundColor Cyan
python -m pymobiledevice3 mounter auto-mount

# 4. Launch Tunnel and Capture Data
Write-Host "[*] Starting RSD Tunnel..." -ForegroundColor Cyan
$jsonPath = Join-Path $PSScriptRoot "tunnel_state.json"

# We use a script block to run the tunnel and parse output in real-time
$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = "python"
$processInfo.Arguments = "-m pymobiledevice3 lockdown start-tunnel"
$processInfo.RedirectStandardOutput = $true
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $false # Keep window visible for the tunnel

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $processInfo
$process.Start() | Out-Null

$address = $null
$port = $null

Write-Host "[*] Waiting for RSD parameters..." -ForegroundColor Yellow

# Read output line by line until we find what we need
while (-not $process.StandardOutput.EndOfStream) {
    $line = $process.StandardOutput.ReadLine()
    Write-Host "PMD3: $line" -ForegroundColor Gray

    if ($line -match '(?<=RSD Address: )([a-f0-9:]+)') {
        $address = $Matches[1]
        Write-Host "[+] Captured RSD Address: $address" -ForegroundColor Green
    }
    if ($line -match '(?<=RSD Port: )(\d+)') {
        $port = $Matches[1]
        Write-Host "[+] Captured RSD Port: $port" -ForegroundColor Green
    }

    if ($null -ne $address -and $null -ne $port) {
        # Save to JSON
        $data = @{
            address = $address
            port = $port
            timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        }
        $data | ConvertTo-Json | Out-File -FilePath $jsonPath -Encoding utf8
        Write-Host "[+++] RSD Tunnel is ACTIVE and parameters are cached." -ForegroundColor Cyan
        Write-Host "[i] You can now use .\set_location.ps1" -ForegroundColor Cyan
        break
    }
}

# The tunnel process continues to run in the background if we don't kill it.
# However, if this script ends, the process might be closed if not handled properly.
# For simplicity in this orchestrator, we will wait for the process to exit or let it run.
# If the user wants to keep the tunnel open, we should probably stay in this loop or inform the user.
Write-Host "[*] Tunnel process remains active (PID: $($process.Id)). Press Ctrl+C to terminate both." -ForegroundColor Yellow

try {
    while ($true) {
        if ($process.HasExited) {
            Write-Warning "Tunnel process exited unexpectedly."
            break
        }
        Start-Sleep -Seconds 1
    }
} finally {
    if (-not $process.HasExited) {
        Write-Host "[*] Cleaning up tunnel..." -ForegroundColor Red
        $process.Kill()
    }
}
