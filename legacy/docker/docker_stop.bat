@echo off
cd /d "%~dp0"
echo ===========================================
echo    GPS MOCK SERVER - DOCKER STOP
echo ===========================================
echo.
echo [server] Arret des conteneurs en cours...
docker compose down
echo.
echo [OK] Tout est arrete.
pause
