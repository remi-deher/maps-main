@echo off
:: Script de démarrage iOS-Enroller avec droits Administrateur
:: Nécessaire pour lire le dossier protégé C:\ProgramData\Apple\Lockdown

:-------------------------------------
REM --> Verification des permissions
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"

REM --> Si erreur, on n'a pas les droits admin. On demande l'élévation.
if '%errorlevel%' NEQ '0' (
    echo ----------------------------------------------------
    echo L'application necessite les droits Administrateur
    echo pour lire les certificats Apple de l'iPhone.
    echo ----------------------------------------------------
    echo Demande des privileges en cours...
    goto UACPrompt
) else ( goto gotAdmin )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"

    "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    if exist "%temp%\getadmin.vbs" ( del "%temp%\getadmin.vbs" )
    :: Revenir dans le dossier du script apres l'elevation UAC
    pushd "%CD%"
    CD /D "%~dp0"

echo.
echo ===========================================
echo       iOS-Enroller - Serveur Actif
echo ===========================================
echo Le serveur fonctionne sur http://localhost:3001
echo Ne fermez pas cette fenetre tant que vous l'utilisez.
echo.

:: Ouvre le navigateur par defaut
start http://localhost:3001

:: Lance le serveur Node.js
node server.js

pause
