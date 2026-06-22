; Inno Setup script for the GPS-Mock engine (Windows).
; Packages the portable bundle (engine .exe + resources/ with both iOS drivers:
; go-ios and the python-embed + pymobiledevice3 distribution) into a per-user
; installer with a Start-menu shortcut and an uninstaller.
;
; Built in CI (.github/workflows/release.yml); the version and the unpacked
; bundle directory are passed in:
;   iscc /DAppVersion=0.2.0 /DBundleDir=..\..\bundle installer\windows\gpsmock.iss

#define AppName "GPS-Mock Engine"
#define AppPublisher "remi-deher"
#define AppExeName "gpsmock-engine-windows-amd64.exe"

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef BundleDir
  #define BundleDir "bundle"
#endif

[Setup]
AppId={{8E5D2B1A-7C4F-4E9A-9F2D-1B7A3C9E5D02}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
; Per-user install: no administrator rights required.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=.
OutputBaseFilename=gpsmock-engine-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayName={#AppName} {#AppVersion}

[Files]
; The whole portable bundle: engine exe + resources/ (go-ios, python-embed).
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Lancer {#AppName} maintenant"; Flags: nowait postinstall skipifsilent
