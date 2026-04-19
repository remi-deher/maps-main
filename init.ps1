# init.ps1 — Installation des dépendances et lancement de GPS Mock

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host " Installation des dépendances npm..." -ForegroundColor Cyan
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host " npm install a échoué (code $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host " Dépendances installées." -ForegroundColor Green
Write-Host " Lancement de GPS Mock..." -ForegroundColor Cyan

& "$Root\start.bat"