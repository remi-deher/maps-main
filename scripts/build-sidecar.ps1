# By default the sidecar is built with the embedded web UI (-tags webui) so a
# browser on another machine can reach the full interface at http://<ip>:<port>/
# (the remote-access feature). Pass -SkipWebUI for a faster Go-only rebuild when
# iterating on engine code and you don't need the remote browser UI.
param(
    [switch]$SkipWebUI
)

# Get Rust host target triple
$rustInfo = rustc -vV
$targetTriple = ($rustInfo | Select-String "host:").Line.Split(" ")[1]
Write-Host "Detected target triple: $targetTriple"

# Go engine folder
$engineDir = Resolve-Path (Join-Path $PSScriptRoot "../engine")
$tauriAppDir = Resolve-Path (Join-Path $PSScriptRoot "../tauri-app")
$binariesDir = Resolve-Path (Join-Path $PSScriptRoot "../tauri-app/src-tauri")
$binariesDir = Join-Path $binariesDir "binaries"

# Build the web UI and stage it for embedding, mirroring the release pipeline
# (.github/workflows/release.yml: build-webui -> download into
# engine/internal/webui/embedded -> go build -tags webui). Without this the
# engine serves no UI at / and remote browsers get a 404.
$buildTags = @()
$embeddedDir = Join-Path $engineDir "internal/webui/embedded"
if (-not $SkipWebUI) {
    Write-Host "Building web UI for embedding..." -ForegroundColor Cyan
    Push-Location $tauriAppDir
    npm run build
    $npmExit = $LASTEXITCODE
    Pop-Location
    if ($npmExit -ne 0) {
        throw "frontend 'npm run build' failed with exit code $npmExit"
    }
    if (Test-Path $embeddedDir) {
        Remove-Item -Recurse -Force $embeddedDir
    }
    New-Item -ItemType Directory -Path $embeddedDir | Out-Null
    Copy-Item -Recurse -Force (Join-Path $tauriAppDir "dist/*") $embeddedDir
    $buildTags = @("-tags", "webui")
    Write-Host "Web UI staged at $embeddedDir (engine will serve it at /)" -ForegroundColor Green
} else {
    Write-Host "Skipping web UI embed (-SkipWebUI): remote browser access will be unavailable." -ForegroundColor Yellow
}

# Create binaries dir if not exists
if (!(Test-Path $binariesDir)) {
    New-Item -ItemType Directory -Path $binariesDir | Out-Null
}

# Output binary name
$ext = ""
if ($targetTriple -like "*windows*") {
    $ext = ".exe"
}
$outputName = "gpsmock-engine-$targetTriple$ext"
$outputPath = Join-Path $binariesDir $outputName

Write-Host "Building Go engine to sidecar path..."
Push-Location $engineDir
go build @buildTags -o $outputPath ./cmd/headless
$goBuildExitCode = $LASTEXITCODE
Pop-Location
if ($goBuildExitCode -ne 0) {
    throw "go build failed with exit code $goBuildExitCode"
}
if (!(Test-Path $outputPath)) {
    throw "go build reported success but $outputPath is missing"
}

Write-Host "Sidecar binary created successfully at: $outputPath"

# Bundle the iOS drivers as Tauri resources next to the sidecar so the engine
# (which resolves resources/ relative to its executable) finds them at runtime
# with no system install. resource_dir paths are passed explicitly by the Rust
# side (see bundled_driver_envs in src-tauri/src/lib.rs).
$resourcesDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "../tauri-app/src-tauri")) "resources"
# The desktop app ships the full experience: both drivers, Python included.
& (Join-Path $PSScriptRoot "bundle-drivers.ps1") -TargetDir $resourcesDir -IncludePython
