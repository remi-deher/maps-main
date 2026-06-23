; Inno Setup script for the GPS-Mock engine (Windows).
; Wraps the single self-contained portable .exe (engine + both iOS drivers
; embedded, see -tags embed_drivers) into a per-user installer with a
; Start-menu shortcut and an uninstaller. No resources folder: the drivers
; live inside the .exe and extract to %LOCALAPPDATA% on first launch.
;
; Built in CI (.github/workflows/release.yml); the version and the path to the
; portable .exe are passed in:
;   iscc /DAppVersion=0.2.1 /DPortableExe=..\..\gpsmock-engine-portable.exe installer\windows\gpsmock.iss

#define AppName "GPS-Mock Engine"
#define AppPublisher "remi-deher"
#define AppExeName "gpsmock-engine.exe"

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef PortableExe
  #define PortableExe "gpsmock-engine-portable.exe"
#endif

[Setup]
AppId={{8E5D2B1A-7C4F-4E9A-9F2D-1B7A3C9E5D02}
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
; The single self-contained engine .exe (drivers are embedded inside it).
Source: "{#PortableExe}"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Lancer {#AppName} maintenant"; Flags: nowait postinstall skipifsilent

[Code]
// Kill all GPS-Mock background processes before copying new files.
// These are headless daemons (go-ios tunnel, python workers) that must be
// terminated before the installer can replace the engine executable.
procedure KillProcess(ExeName: String);
var
  ResultCode: Integer;
begin
  // /F  force, /T  kill entire process tree (children included)
  Exec('taskkill.exe', '/F /T /IM "' + ExeName + '"', '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);
  // ResultCode 0 = found & killed, 128 = not found — both are fine.
  Sleep(300);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
  begin
    // Stop the engine and its driver sub-processes before overwriting files.
    KillProcess('gpsmock-engine.exe');
    KillProcess('ios.exe');          // go-ios tunnel daemon
    KillProcess('python.exe');       // pymobiledevice3 remote tunneld / location worker
    KillProcess('python3.exe');      // same, Unix-named binary
    // Brief pause to let file handles be released.
    Sleep(500);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    // Stop the engine and its driver sub-processes before uninstalling.
    KillProcess('gpsmock-engine.exe');
    KillProcess('ios.exe');
    KillProcess('python.exe');
    KillProcess('python3.exe');
    Sleep(500);
  end;
end;
