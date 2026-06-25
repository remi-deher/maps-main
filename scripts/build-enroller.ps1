# Script de build de l'exécutable autonome ios-enroller pour Windows
$enrollerDir = Resolve-Path (Join-Path $PSScriptRoot "../ios-enroller")

Write-Host "Dossier ios-enroller : $enrollerDir"

# Entrer dans le dossier
Push-Location $enrollerDir

# 1. Installation des dépendances NPM si nécessaire
Write-Host "Vérification et installation des dépendances Node..."
npm install
$npmExit = $LASTEXITCODE
if ($npmExit -ne 0) {
    Pop-Location
    throw "npm install a échoué avec le code de sortie $npmExit"
}

# 2. Compilation de l'exécutable autonome
Write-Host "Compilation de l'exécutable autonome ios-enroller.exe..."
npx pkg . --output dist/ios-enroller.exe
$pkgExit = $LASTEXITCODE

Pop-Location

if ($pkgExit -ne 0) {
    throw "La compilation avec pkg a échoué avec le code de sortie $pkgExit"
}

Write-Host "`n[SUCCÈS] L'exécutable autonome a été généré avec succès dans :"
Write-Host "   -> ios-enroller/dist/ios-enroller.exe"
