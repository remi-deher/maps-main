#!/bin/bash

echo "[entrypoint] Analyse de l'environnement de connexion iPhone..."

# 1. Vérification si on est sur Windows/Mac (Docker Desktop)
if getent hosts host.docker.internal > /dev/null; then
    echo "[entrypoint] Environnement Windows détecté."
    echo "[entrypoint] Création du pont vers le service Apple hôte (port 27015)..."
    mkdir -p /var/run
    rm -rf /var/run/usbmuxd
    socat UNIX-LISTEN:/var/run/usbmuxd,fork,group=root,mode=777 TCP:host.docker.internal:27015 &
    sleep 2
elif [ -S /var/run/usbmuxd ]; then
    echo "[entrypoint] Environnement Linux avec socket partagé détecté (TrueNAS/Scale)."
    echo "[entrypoint] Utilisation du socket hôte existant."
else
    echo "[entrypoint] Environnement Linux standard détecté."
    echo "[entrypoint] Démarrage d'un service usbmuxd local..."
    mkdir -p /var/run
    rm -rf /var/run/usbmuxd
    usbmuxd --user root &
    sleep 1
fi

echo "[entrypoint] Lancement de l'application Node.js..."
cd /app
exec node server/src/main/index-headless.js
