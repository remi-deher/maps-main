# Populates a resources directory with the bundled iOS drivers so the engine
# runs with no system install:
#   <target>/ios[.exe]            go-ios (all desktop OSes; static, no deps)
#   <target>/wintun.dll           TUN driver go-ios needs to start tunnels (Windows only)
#   <target>/python-embed/        python.org embeddable + pymobiledevice3 (Windows only)
#
# Shared by the Tauri sidecar bundle (scripts/build-sidecar.ps1) and the
# standalone Windows portable zip (.github/workflows/release.yml) so the two
# stay in sync. Requires Go on PATH; the Python/wintun steps run on Windows only.
#
# go-ios (the default driver) is always bundled — it's a single static binary
# and enough for an autonomous setup. python-embed + pymobiledevice3 is the
# heavy, optional driver (~110 MB of wheels); pass -IncludePython to add it.
param(
    [Parameter(Mandatory = $true)][string]$TargetDir,
    [switch]$IncludePython
)

$ErrorActionPreference = "Stop"

$GoIosVersion = "v1.2.0"      # keep in sync with docker/Dockerfile
# Python 3.13+ is required for pymobiledevice3's TCP RSD tunnel: on older
# interpreters `remote tunneld` defaults to the QUIC tunnel, which Apple
# removed in iOS 18.2+ — so a 3.12 bundle silently fails to tunnel modern
# devices. The pmd3 driver forces --protocol tcp when it detects 3.13+.
$PythonVersion = "3.13.1"
$WintunVersion = "0.14.1"

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
$TargetDir = (Resolve-Path $TargetDir).Path

# $IsWindows is undefined in Windows PowerShell 5.1; $env:OS works everywhere
# (set to 'Windows_NT' on Windows, unset on macOS/Linux).
$onWindows = ($env:OS -eq "Windows_NT")

# --- go-ios (every desktop OS) ---
Write-Host "Building go-ios $GoIosVersion into $TargetDir"
$env:GOBIN = $TargetDir
go install "github.com/danielpaulus/go-ios@$GoIosVersion"
if ($LASTEXITCODE -ne 0) { throw "go install go-ios failed" }
# platform.ResolveGoIos looks for "ios"/"ios.exe" first.
$goiosExt = if ($onWindows) { ".exe" } else { "" }
Move-Item -Force "$TargetDir/go-ios$goiosExt" "$TargetDir/ios$goiosExt"

# --- wintun.dll (Windows only) — go-ios needs it next to ios.exe to bring up
# the TUN interface for `ios tunnel start`; without it the tunnel never comes up.
if ($onWindows) {
    Write-Host "Fetching wintun.dll $WintunVersion into $TargetDir"
    $wintunZip = Join-Path $env:TEMP "wintun-$WintunVersion.zip"
    $wintunExtract = Join-Path $env:TEMP "wintun-$WintunVersion"
    Invoke-WebRequest -Uri "https://www.wintun.net/builds/wintun-$WintunVersion.zip" -OutFile $wintunZip
    Expand-Archive -Path $wintunZip -DestinationPath $wintunExtract -Force
    Copy-Item -Force (Join-Path $wintunExtract "wintun/bin/amd64/wintun.dll") (Join-Path $TargetDir "wintun.dll")
    Remove-Item -Force $wintunZip
    Remove-Item -Recurse -Force $wintunExtract
}

# --- python-embed + pymobiledevice3 (Windows only, opt-in) ---
# The embeddable distribution is Windows-only; elsewhere go-ios is the default
# and a user wanting pymobiledevice can rely on a system python3.
if ($onWindows -and $IncludePython) {
    $pyDir = Join-Path $TargetDir "python-embed"
    Write-Host "Setting up python-embed ($PythonVersion) + pymobiledevice3 in $pyDir"
    New-Item -ItemType Directory -Force -Path $pyDir | Out-Null

    $zip = Join-Path $env:TEMP "python-embed.zip"
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $pyDir -Force

    Push-Location $pyDir
    try {
        # Enable site-packages so pip-installed modules import. The embeddable
        # distribution names this file after the version (python313._pth for
        # 3.13.x); derive it so a version bump doesn't silently miss it.
        $pth = Get-ChildItem -Filter 'python3*._pth' | Select-Object -First 1
        (Get-Content $pth.Name) -replace '#import site', 'import site' | Set-Content $pth.Name
        Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile get-pip.py
        ./python.exe get-pip.py --no-warn-script-location
        # setuptools/wheel first: some transitive deps build from source.
        ./python.exe -m pip install --no-cache-dir --upgrade setuptools wheel
        ./python.exe -m pip install --no-cache-dir pymobiledevice3
        Remove-Item get-pip.py
    } finally {
        Pop-Location
    }
}

Write-Host "Driver bundle ready at $TargetDir"
