# Populates a resources directory with the bundled iOS drivers so the engine
# runs with no system install:
#   <target>/ios[.exe]            go-ios (all desktop OSes; static, no deps)
#   <target>/python-embed/        python.org embeddable + pymobiledevice3 (Windows only)
#
# Shared by the Tauri sidecar bundle (scripts/build-sidecar.ps1) and the
# standalone Windows portable zip (.github/workflows/release.yml) so the two
# stay in sync. Requires Go on PATH; the Python steps run on Windows only.
param(
    [Parameter(Mandatory = $true)][string]$TargetDir
)

$ErrorActionPreference = "Stop"

$GoIosVersion = "v1.2.0"      # keep in sync with docker/Dockerfile
$PythonVersion = "3.12.8"

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

# --- python-embed + pymobiledevice3 (Windows only) ---
# The embeddable distribution is Windows-only; elsewhere go-ios is the default
# and a user wanting pymobiledevice can rely on a system python3.
if ($onWindows) {
    $pyDir = Join-Path $TargetDir "python-embed"
    Write-Host "Setting up python-embed ($PythonVersion) + pymobiledevice3 in $pyDir"
    New-Item -ItemType Directory -Force -Path $pyDir | Out-Null

    $zip = Join-Path $env:TEMP "python-embed.zip"
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $pyDir -Force

    Push-Location $pyDir
    try {
        # Enable site-packages so pip-installed modules import.
        (Get-Content python312._pth) -replace '#import site', 'import site' | Set-Content python312._pth
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
