#!/bin/bash
# ==============================================================================
# GPS MOCK SERVER - SCRIPT DE PROVISIONNEMENT (DEBIAN 12 MINIMAL)
# ==============================================================================

set -e

echo "-------------------------------------------------------"
echo "🚀 Démarrage de l'installation ultra-légère..."
echo "-------------------------------------------------------"

# 1. Mise à jour système
sudo apt update && sudo apt upgrade -y

# 2. Installation des dépendances système de base
sudo apt install -y \
    curl \
    wget \
    git \
    unzip \
    lsb-release \
    gnupg \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    libusb-1.0-0 \
    usbmuxd \
    libimobiledevice-utils \
    avahi-daemon \
    avahi-utils \
    libavahi-client3 \
    nginx \
    ufw

# 3. Installation de Node.js 20 (LTS)
if ! command -v node &> /dev/null; then
    echo "[info] Installation de Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# 4. Installation de PM2 (Gestionnaire de processus)
sudo npm install -g pm2

# 5. Installation de go-ios
echo "[info] Installation de go-ios v1.0.211..."
wget https://github.com/danielpaulus/go-ios/releases/download/v1.0.211/go-ios-linux.zip -O /tmp/go-ios.zip
sudo unzip -o /tmp/go-ios.zip -d /usr/local/bin/
sudo mv /usr/local/bin/ios-amd64 /usr/local/bin/ios || true
sudo chmod +x /usr/local/bin/ios
rm /tmp/go-ios.zip

# 6. Configuration de l'environnement Python pour pymobiledevice3
echo "[info] Préparation de l'environnement Python..."
python3 -m venv /opt/gps-venv
/opt/gps-venv/bin/pip install --upgrade pip
/opt/gps-venv/bin/pip install pymobiledevice3

# 7. Configuration de Nginx
echo "[info] Configuration de Nginx..."
sudo rm -f /etc/nginx/sites-enabled/default

# 8. Configuration du pare-feu (UFW)
echo "[info] Configuration du pare-feu..."
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 5353/udp
sudo ufw allow 22/tcp
# Autoriser les ports dynamiques pour les tunnels iOS
sudo ufw allow 32000:65000/tcp
sudo ufw --force enable

# 9. Création des dossiers de l'application
sudo mkdir -p /opt/gps-mock
sudo chown $USER:$USER /opt/gps-mock

echo "-------------------------------------------------------"
echo "✅ Provisionnement terminé !"
echo "-------------------------------------------------------"
echo "Prochaines étapes :"
echo "1. Copie le dossier 'server' de ton PC vers /opt/gps-mock/server sur la VM"
echo "2. Copie tes fichiers .plist dans /var/lib/lockdown/"
echo "3. Exécute : cd /opt/gps-mock/server && npm install --production"
echo "4. Utilise 'pm2 start ecosystem.config.js' pour lancer le serveur"
echo "-------------------------------------------------------"
