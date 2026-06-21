<#
.SYNOPSIS
  Install and manage the GPS-Mock headless engine as a Windows service.

.EXAMPLE
  # (Run an elevated PowerShell)
  .\gpsmock-ctl.ps1 install -Driver pymobiledevice -Transport usb -Addr ':8080'
  .\gpsmock-ctl.ps1 start | stop | restart | status | logs | config | uninstall
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs', 'config')]
  [string]$Command = 'status',

  [string]$Driver = 'pymobiledevice',
  [string]$Transport = 'auto',
  [string]$Addr = ':8080',
  [string]$Rsd = '',
  [string]$GoiosBin = '',
  [string]$PythonBin = '',
  [string]$Binary = ''
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'gpsmock'
$Root = Join-Path $env:ProgramData 'gpsmock'
$ExeDst = Join-Path $Root 'gpsmock-engine.exe'
$LogDir = Join-Path $Root 'logs'
$LogFile = Join-Path $LogDir 'engine.log'
$ConfigFile = Join-Path $Root 'config.json'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EngineDir = Resolve-Path (Join-Path $ScriptDir '..\..\engine') -ErrorAction SilentlyContinue

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Require-Admin($what) {
  if (-not (Test-Admin)) {
    throw "'$what' requires an elevated (Administrator) PowerShell."
  }
}

function Resolve-Binary {
  if ($Binary -ne '') {
    if (-not (Test-Path $Binary)) { throw "binary not found: $Binary" }
    return (Resolve-Path $Binary).Path
  }
  if ($EngineDir) {
    $prebuilt = Join-Path $EngineDir 'bin\headless.exe'
    if (Test-Path $prebuilt) { return $prebuilt }
    if (Get-Command go -ErrorAction SilentlyContinue) {
      Write-Host 'building engine from source...'
      Push-Location $EngineDir
      try { & go build -o bin\headless.exe .\cmd\headless } finally { Pop-Location }
      if (Test-Path $prebuilt) { return $prebuilt }
    }
  }
  throw 'no binary found and cannot build (provide -Binary PATH or install Go).'
}

function Build-Args {
  $a = @("-addr $Addr", "-driver $Driver", "-transport $Transport", "-log-file `"$LogFile`"")
  if ($Rsd -ne '') { $a += "-rsd $Rsd" }
  if ($GoiosBin -ne '') { $a += "-goios-bin `"$GoiosBin`"" }
  if ($PythonBin -ne '') { $a += "-python-bin `"$PythonBin`"" }
  return ($a -join ' ')
}

function Invoke-Install {
  Require-Admin 'install'
  $src = Resolve-Binary
  New-Item -ItemType Directory -Force -Path $Root, $LogDir | Out-Null
  Copy-Item -Path $src -Destination $ExeDst -Force

  $argString = Build-Args
  $binPath = "`"$ExeDst`" $argString"

  # Persist the chosen options for `config`.
  [pscustomobject]@{
    driver = $Driver; transport = $Transport; addr = $Addr; rsd = $Rsd
    goiosBin = $GoiosBin; pythonBin = $PythonBin; binPath = $binPath
  } | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding utf8

  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "service exists; recreating..."
    & sc.exe stop $ServiceName | Out-Null
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
  }

  New-Service -Name $ServiceName -BinaryPathName $binPath `
    -DisplayName 'GPS-Mock headless engine' -StartupType Automatic | Out-Null
  Start-Service -Name $ServiceName
  Write-Host "installed and started '$ServiceName'. Logs: $LogFile"
  Get-Service -Name $ServiceName | Format-Table -AutoSize
}

function Invoke-Uninstall {
  Require-Admin 'uninstall'
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
    Write-Host "removed service '$ServiceName'. (files under $Root kept; delete manually if desired)"
  } else {
    Write-Host "service '$ServiceName' is not installed."
  }
}

switch ($Command) {
  'install' { Invoke-Install }
  'uninstall' { Invoke-Uninstall }
  'start' { Require-Admin 'start'; Start-Service $ServiceName; Get-Service $ServiceName }
  'stop' { Require-Admin 'stop'; Stop-Service $ServiceName -Force; Get-Service $ServiceName }
  'restart' { Require-Admin 'restart'; Restart-Service $ServiceName -Force; Get-Service $ServiceName }
  'status' { Get-Service $ServiceName | Format-List Name, Status, StartType, DisplayName }
  'logs' {
    if (-not (Test-Path $LogFile)) { throw "no log file yet at $LogFile" }
    Get-Content -Path $LogFile -Tail 40 -Wait
  }
  'config' {
    if (Test-Path $ConfigFile) { Get-Content $ConfigFile } else { throw 'not installed.' }
  }
}
