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
Pop-Location

Write-Host "Sidecar binary created successfully at: $outputPath"
