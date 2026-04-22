param(
    [string] $PythonVersion = '3.12.8',
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DestDir   = Join-Path $ScriptDir 'resources\python'
$TmpDir    = Join-Path $ScriptDir '.tmp-python-setup'

$VerParts = $PythonVersion -split '\.'
$ShortVer = $VerParts[0] + $VerParts[1]
$ZipName  = 'python-' + $PythonVersion + '-embed-amd64.zip'
$ZipUrl   = 'https://www.python.org/ftp/python/' + $PythonVersion + '/' + $ZipName
$PthFile  = 'python' + $ShortVer + '._pth'

Write-Host ''
Write-Host '================================================' -ForegroundColor Cyan
Write-Host "   GPS Mock - Setup Python $PythonVersion portable" -ForegroundColor Cyan
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ''

$PythonExe = Join-Path $DestDir 'python.exe'

if ((Test-Path $PythonExe) -and -not $Force) {
    Write-Host '[OK] Python portable deja present dans resources/python/' -ForegroundColor Green
    $PmdPath = Join-Path $DestDir 'Lib\site-packages\pymobiledevice3'
    if (Test-Path $PmdPath) {
        Write-Host '[OK] pymobiledevice3 deja installe' -ForegroundColor Green
    } else {
        Write-Host '[!!] pymobiledevice3 absent - relance avec -Force pour reinstaller' -ForegroundColor Yellow
    }
    Write-Host ''
    exit 0
}

# ─── Preparation des dossiers ─────────────────────────────────────────────────

Write-Host '[..] Preparation des dossiers...' -ForegroundColor Yellow

if (Test-Path $DestDir) { Remove-Item -Recurse -Force $DestDir }
if (Test-Path $TmpDir)  { Remove-Item -Recurse -Force $TmpDir }

New-Item -ItemType Directory -Path $DestDir | Out-Null
New-Item -ItemType Directory -Path $TmpDir  | Out-Null

Write-Host '[OK] Dossiers crees' -ForegroundColor Green
Write-Host ''

# ─── Telecharger le zip embeddable ────────────────────────────────────────────

$ZipPath = Join-Path $TmpDir $ZipName

Write-Host "[..] Telechargement de $ZipName ..." -ForegroundColor Yellow
Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath
Write-Host '[OK] Telechargement termine' -ForegroundColor Green
Write-Host ''

# ─── Extraire dans resources/python/ ─────────────────────────────────────────

Write-Host '[..] Extraction du zip...' -ForegroundColor Yellow
Expand-Archive -Path $ZipPath -DestinationPath $DestDir -Force
Write-Host '[OK] Extraction terminee' -ForegroundColor Green
Write-Host ''

# ─── Activer les imports (modifier le .pth) ────────────────────────────────────

$PthPath = Join-Path $DestDir $PthFile
Write-Host "[..] Activation de site.py dans $PthFile ..." -ForegroundColor Yellow

if (-not (Test-Path $PthPath)) {
    Write-Host "[KO] Fichier .pth introuvable : $PthPath" -ForegroundColor Red
    exit 1
}

$lines = Get-Content $PthPath
$newLines = @()
foreach ($line in $lines) {
    if ($line -match '^#\s*import site') {
        $newLines += 'import site'
    } else {
        $newLines += $line
    }
}

Set-Content -Path $PthPath -Value $newLines
Write-Host '[OK] site.py active' -ForegroundColor Green
Write-Host ''

# ─── Installer PIP dans le Python portable ────────────────────────────────────

Write-Host '[..] Telechargement de get-pip.py ...' -ForegroundColor Yellow
$GetPipPath = Join-Path $TmpDir 'get-pip.py'
Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $GetPipPath

Write-Host '[..] Installation de pip dans l environnement portable...' -ForegroundColor Yellow
& $PythonExe $GetPipPath --no-warn-script-location
if ($LASTEXITCODE -ne 0) {
    Write-Host "[KO] Echec de l'installation de pip (code $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}
Write-Host '[OK] pip installe avec succes' -ForegroundColor Green
Write-Host ''

# ─── Installer les outils de build (Requis pour hexdump) ──────────────────────

Write-Host '[..] Installation de setuptools et wheel...' -ForegroundColor Yellow
& $PythonExe -m pip install setuptools wheel --no-warn-script-location
if ($LASTEXITCODE -ne 0) {
    Write-Host "[KO] Echec de l'installation de setuptools (code $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}
Write-Host '[OK] Outils de build installes' -ForegroundColor Green
Write-Host ''

# ─── Installer pymobiledevice3 ────────────────────────────────────────────────

Write-Host '[..] Installation de pymobiledevice3 via le pip portable...' -ForegroundColor Yellow
& $PythonExe -m pip install pymobiledevice3 --no-warn-script-location
if ($LASTEXITCODE -ne 0) {
    Write-Host "[KO] Echec de l'installation de pymobiledevice3 (code $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}
Write-Host ''
Write-Host '[OK] pymobiledevice3 installe' -ForegroundColor Green
Write-Host ''

# ─── Verification finale ──────────────────────────────────────────────────────

Write-Host '[..] Verification de l import...' -ForegroundColor Yellow
$CheckOutput = & $PythonExe -c 'import pymobiledevice3; print("OK")' 2>&1
if ($CheckOutput -match 'OK') {
    Write-Host '[OK] pymobiledevice3 importable depuis le Python portable' -ForegroundColor Green
} else {
    Write-Host "[!!] Verification import : $CheckOutput" -ForegroundColor Yellow
}

$FolderItems = Get-ChildItem -Recurse $DestDir
$TotalBytes  = ($FolderItems | Measure-Object -Property Length -Sum).Sum
$SizeMb      = [math]::Round($TotalBytes / 1MB, 0)
Write-Host "     Taille de resources/python/ : $SizeMb Mo" -ForegroundColor Gray

# ─── Nettoyage ───────────────────────────────────────────────────────────────

Remove-Item -Recurse -Force $TmpDir

Write-Host ''
Write-Host '================================================' -ForegroundColor Green
Write-Host '   [OK] Python portable pret !' -ForegroundColor Green
Write-Host '================================================' -ForegroundColor Green
Write-Host ''