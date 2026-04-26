@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===========================================
echo    GPS MOCK SERVER - DOCKER START
echo ===========================================
echo.

:: 1. Verification du Dashboard (dist-web)
if exist "..\server\dist-web\renderer-v2\index.html" goto DOCKER_RUN

echo [!] Dashboard (dist-web) manquant dans le dossier server.
echo [!] Tentative de build du Dashboard...
echo.

if not exist "..\server" (
    echo [ERROR] Dossier server introuvable !
    pause
    exit /b
)

pushd "..\server"
call npm install
echo [server] Generation du build Vite...
call npm run vite:build
popd

:: Verification si le build a reussi
if exist "..\server\dist-web\renderer-v2\index.html" (
    echo [OK] Dashboard build avec succes.
) else (
    echo [ERROR] Le build du Dashboard a echoue. Verifiez le dossier server\dist-web\renderer-v2.
    pause
    exit /b
)

:DOCKER_RUN
:: 2. Lancement de Docker Compose
echo.
echo [server] Construction et demarrage du conteneur...
docker compose up --build -d

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker Compose a rencontre une erreur.
    pause
    exit /b
)

echo.
echo [OK] Le serveur est en cours de demarrage.
echo [OK] Interface disponible sur : http://localhost:8080
echo.

:: 3. Ouverture du navigateur
start http://localhost:8080

echo Appuyez sur une touche pour voir les logs (Ctrl+C pour quitter)...
pause > nul
docker compose logs -f
