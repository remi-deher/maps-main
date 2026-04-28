#!/bin/sh
set -e

echo "[boot] Initialisation du système..."

# 1. Préparation des répertoires de runtime
mkdir -p /var/run/dbus /var/run/avahi-daemon
rm -f /var/run/dbus/pid /var/run/avahi-daemon/pid

# 2. Configuration Réseau & Avahi
# Forcer l'activation de l'IPv6 (crucial pour le service 'remoted')
sysctl -w net.ipv6.conf.all.disable_ipv6=0 || true
sysctl -w net.ipv6.conf.eth0.disable_ipv6=0 || true

echo "[boot] État réseau IPv6 :"
ip -6 addr show eth0 || echo "Pas d'IPv6 sur eth0"

sed -i 's/.*use-ipv6=.*/use-ipv6=yes/' /etc/avahi/avahi-daemon.conf
sed -i 's/.*enable-dbus=.*/enable-dbus=yes/' /etc/avahi/avahi-daemon.conf

# 3. Démarrage des démons
echo "[boot] Démarrage D-Bus..."
dbus-daemon --system --fork || true

echo "[boot] Démarrage Avahi..."
# On donne les droits au dossier de socket
chown -R avahi:avahi /var/run/avahi-daemon
avahi-daemon --daemonize --no-drop-root || true

echo "[boot] Analyse environnement..."
if getent hosts host.docker.internal > /dev/null; then
    echo "[boot] Windows détecté. Pont socat vers l'hôte..."
    mkdir -p /var/run && rm -rf /var/run/usbmuxd
    socat UNIX-LISTEN:/var/run/usbmuxd,fork,group=root,mode=777 TCP:host.docker.internal:27015 &
elif [ -S /var/run/usbmuxd ]; then
    echo "[boot] Socket partagé détecté."
else
    echo "[boot] Linux standard. Démarrage usbmuxd..."
    mkdir -p /var/run && rm -rf /var/run/usbmuxd
    usbmuxd --user root &
fi

sleep 2

echo "[boot] Lancement Node.js..."
cd /app && exec node server/src/main/index-headless.js
