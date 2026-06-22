# install.ps1 — GPS-Mock bootstrapper for Windows.
#
# Always resolves the *latest* GitHub release at run time (never bundles a
# version itself), asks which variant to install, downloads only that one
# asset, and offers to register the headless engine as a Windows service.
#
# Usage:
#   irm https://raw.githubusercontent.com/remi-deher/maps-main/main/scripts/install.ps1 | iex
#   .\install.ps1 -Variant headless|desktop [-Service] [-Dest DIR]
param(
    [ValidateSet("headless", "desktop")]
    [string]$Variant,
    [switch]$Service,
    [string]$Dest
)

$ErrorActionPreference = "Stop"

$Repo = "remi-deher/maps-main"
$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
$RawBase = "https://raw.githubusercontent.com/$Repo/main"

Write-Host "Recherche de la dernière version sur GitHub ($Repo)..."
$release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "gpsmock-installer" }
$tag = $release.tag_name
if (-not $tag) {
    Write-Error "impossible de déterminer la dernière version (réponse GitHub inattendue)."
    exit 1
}
Write-Host "Dernière version : $tag"

function Get-AssetUrl([string]$NamePattern) {
    $asset = $release.assets | Where-Object { $_.name -like $NamePattern } | Select-Object -First 1
    if ($asset) { return $asset.browser_download_url }
    return $null
}

if (-not $Variant) {
    Write-Host ""
    Write-Host "Quelle variante installer ?"
    Write-Host "  1) Moteur headless + UI web (un seul .exe, serveur/automatisation)"
    Write-Host "  2) Application desktop complète (interface native, Tauri)"
    $choice = Read-Host "Choix [1/2]"
    $Variant = switch ($choice) {
        "1" { "headless" }
        "2" { "desktop" }
        default { Write-Error "choix invalide."; exit 1 }
    }
}

if ($Variant -eq "headless") {
    # Portable build: single .exe, both iOS drivers + web UI embedded, nothing
    # to unzip — the build already optimized for this (see UX tracker).
    $url = Get-AssetUrl "gpsmock-engine-portable.exe"
    if (-not $url) {
        Write-Error "aucun asset 'gpsmock-engine-portable.exe' trouvé dans la release $tag."
        exit 1
    }
    $destDir = if ($Dest) { $Dest } else { "$env:ProgramData\gpsmock" }
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $destExe = Join-Path $destDir "gpsmock-engine-portable.exe"

    Write-Host "Téléchargement de gpsmock-engine-portable.exe ($tag)..."
    Invoke-WebRequest -Uri $url -OutFile $destExe
    Write-Host "Installé : $destExe"

    if (-not $Service) {
        $svc = Read-Host "Installer comme service Windows maintenant (démarrage auto) ? [o/N]"
        if ($svc -match "^[oOyY]") { $Service = $true }
    }

    if ($Service) {
        $ctlTmp = Join-Path $env:TEMP "gpsmock-ctl.ps1"
        Invoke-WebRequest -Uri "$RawBase/scripts/windows/gpsmock-ctl.ps1" -OutFile $ctlTmp
        & $ctlTmp install -Binary $destExe
        Remove-Item $ctlTmp -Force
    } else {
        Write-Host "Lancer manuellement : $destExe"
    }
} else {
    $url = Get-AssetUrl "*_x64-setup.exe"
    if (-not $url) {
        Write-Error "aucun installeur desktop (*_x64-setup.exe) trouvé dans la release $tag."
        exit 1
    }
    $destDir = if ($Dest) { $Dest } else { "$env:USERPROFILE\Downloads" }
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $name = Split-Path $url -Leaf
    $destFile = Join-Path $destDir $name

    Write-Host "Téléchargement de $name ($tag)..."
    Invoke-WebRequest -Uri $url -OutFile $destFile
    Write-Host "Téléchargé : $destFile"
    Write-Host "Lancement de l'installeur..."
    Start-Process $destFile
}
