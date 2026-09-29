; Inno Setup script for the CAIN Keeper Windows installer.
; Built by .github/workflows/build-package.yml with:
;   iscc installer\windows.iss /DMyAppVersion=1.2.3 /DSourceDir=dist\CAIN-Keeper
;        /DOutputDir=. /DMyOutputBaseName=CAIN-Keeper-Setup-1.2.3-windows-x64
; All four are passed in so the workflow's computed release version, output
; naming convention and PyInstaller output path stay the single source of
; truth - nothing about the build is hardcoded here.

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\CAIN-Keeper"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif
#ifndef MyOutputBaseName
  #define MyOutputBaseName "CAIN-Keeper-Setup-" + MyAppVersion
#endif

#define MyAppName "CAIN Keeper"
#define MyAppExeName "CAIN-Keeper.exe"
#define MyAppPublisher "CAIN Keeper"
#define MyAppURL "https://github.com/reeper316099/CAIN-Keeper"

[Setup]
AppId={{B6E3B5B0-6C1E-4B0A-9B2E-3B7E1F2E7C10}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#MyOutputBaseName}
SetupIconFile=..\assets\icons\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
; Not code-signed (see README) - Inno Setup + SmartScreen will still warn on
; first run, same as the plain zip build always has.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
