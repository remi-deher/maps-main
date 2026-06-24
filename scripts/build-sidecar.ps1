# Get Rust host target triple
$rustInfo = rustc -vV
$targetTriple = ($rustInfo | Select-String "host:").Line.Split(" ")[1]
Write-Host "Detected target triple: $targetTriple"

# Go engine folder
$engineDir = Resolve-Path (Join-Path $PSScriptRoot "../engine")
$binariesDir = Resolve-Path (Join-Path $PSScriptRoot "../tauri-app/src-tauri")
$binariesDir = Join-Path $binariesDir "binaries"

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
go build -o $outputPath ./cmd/headless
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
