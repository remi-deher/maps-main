#!/bin/bash

# GPS Mock - Universal Manager (Linux)
# Version 2.2.0

# --- 1. Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# --- 2. Check for Sudo ---
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}🚨 Ce script nécessite les droits SUDO.${NC}"
   exit 1
fi

# --- 3. Paths ---
ROOT_DIR=$(pwd)
SERVER_DIR="$ROOT_DIR/server"
SETTINGS_PATH="$SERVER_DIR/src/main/core/storage/settings.json"

get_mode() {
    if [ -f "$SETTINGS_PATH" ]; then
        # Extraction simple via grep pour éviter une dépendance à jq
        if grep -q '"manualTunnelMode": true' "$SETTINGS_PATH"; then
            echo "HEADLESS"
        else
            echo "AUTO/GUI"
        fi
    else
        echo "NON CONFIGURÉ"
    fi
}

check_service_status() {
    if systemctl is-active --quiet gps-mock; then
        echo -e "${GREEN}ACTIF (Systemd)${NC}"
    else
        echo -e "${RED}INACTIF${NC}"
    fi
}

# --- 4. Menu ---
show_menu() {
    clear
    MODE=$(get_mode)
    echo -e "${CYAN}=========================================${NC}"
    echo -e "      📍 GPS MOCK - MANAGER V2 (Linux)"
    echo -e "${CYAN}=========================================${NC}"
    echo -n -e " État Service : "
    check_service_status
    echo -e " Mode Actuel  : ${CYAN}$MODE${NC}"
    echo -e "${CYAN}=========================================${NC}"
    echo -e " 1) 🛠️  Installation / Réparation"
    echo -e " 2) 🚀  Démarrer le Service (Headless)"
    echo -e " 3) 🛑  Arrêter le Service"
    echo -e " 4) 📜  Voir les Logs (journalctl)"
    echo -e " 5) 🔍  Diagnostic iPhone"
    echo -e " 6) 🔄  Mise à jour (Git Pull)"
    echo -e " 0) ❌  Quitter"
    echo -e "${CYAN}=========================================${NC}"
}

# --- 5. Actions ---

action_install() {
    echo -e "\n${YELLOW}[1/4] Installation des dépendances système...${NC}"
    apt-get update && apt-get install -y usbmuxd libimobiledevice-utils avahi-daemon python3 python3-pip
    
    echo -e "${YELLOW}[2/4] Installation des dépendances Node.js...${NC}"
    cd "$SERVER_DIR" || exit
    npm install
    
    echo -e "${YELLOW}[3/4] Création du service Systemd...${NC}"
    SERVICE_FILE="/etc/systemd/system/gps-mock.service"
    cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=GPS Mock Server
After=network.target avahi-daemon.service usbmuxd.service

[Service]
Type=simple
User=$(logname)
WorkingDirectory=$SERVER_DIR
ExecStart=/usr/bin/node $SERVER_DIR/headless-entry.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable gps-mock
    
    echo -e "\n${GREEN}✅ Installation terminée !${NC}"
    read -p "Appuyez sur Entrée pour continuer..."
}

action_start() {
    echo -e "\n${CYAN}🚀 Démarrage du service...${NC}"
    systemctl start gps-mock
    echo -e "${GREEN}✅ Service démarré.${NC}"
    read -p "Appuyez sur Entrée pour continuer..."
}

action_stop() {
    echo -e "\n${YELLOW}🛑 Arrêt du service...${NC}"
    systemctl stop gps-mock
    echo -e "${GREEN}✅ Service arrêté.${NC}"
    read -p "Appuyez sur Entrée pour continuer..."
}

action_logs() {
    echo -e "\n${CYAN}📜 Affichage des logs (Ctrl+C pour quitter)...${NC}"
    journalctl -u gps-mock -f
}

action_diag() {
    echo -e "\n${CYAN}🔍 Diagnostic USB...${NC}"
    if command -v idevice_id &> /dev/null; then
        idevice_id -l
    else
        echo "idevice_id non trouvé. Installez libimobiledevice-utils."
    fi
    read -p "Appuyez sur Entrée pour continuer..."
}

action_update() {
    echo -e "\n${CYAN}🔄 Mise à jour depuis Git...${NC}"
    cd "$ROOT_DIR" || exit
    git pull
    cd "$SERVER_DIR" || exit
    npm install
    systemctl restart gps-mock
    echo -e "${GREEN}✅ Mise à jour et redémarrage terminés.${NC}"
    read -p "Appuyez sur Entrée pour continuer..."
}

# --- Main Loop ---
while true; do
    show_menu
    read -p "Choisissez une option [0-6] : " choice
    case $choice in
        1) action_install ;;
        2) action_start ;;
        3) action_stop ;;
        4) action_logs ;;
        5) action_diag ;;
        6) action_update ;;
        0) exit 0 ;;
        *) echo -e "${RED}Option invalide.${NC}"; sleep 1 ;;
    esac
done
