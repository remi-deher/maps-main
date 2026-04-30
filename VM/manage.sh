#!/bin/bash
# ==============================================================================
# GPS MOCK SERVER - SCRIPT DE MANAGEMENT INTERACTIF
# ==============================================================================

# Couleurs pour l'affichage
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

APP_DIR="/opt/gps-mock"
SERVICE_NAME="gps-mock"

function header() {
    clear
    echo -e "${BLUE}=======================================================${NC}"
    echo -e "${BLUE}       GPS MOCK SERVER - GESTIONNAIRE VM               ${NC}"
    echo -e "${BLUE}=======================================================${NC}"
    echo ""
}

function wait_key() {
    echo ""
    read -p "Appuyez sur une touche pour revenir au menu..."
}

function check_status() {
    header
    echo -e "${YELLOW}[ ÉTAT DES SERVICES ]${NC}"
    
    # GPS Mock Server
    if systemctl is-active --quiet $SERVICE_NAME; then
        echo -e "  GPS Mock Server : ${GREEN}ACTIF${NC}"
    else
        echo -e "  GPS Mock Server : ${RED}INACTIF${NC}"
    fi

    # Nginx
    if systemctl is-active --quiet nginx; then
        echo -e "  Nginx (Web)     : ${GREEN}ACTIF${NC}"
    else
        echo -e "  Nginx (Web)     : ${RED}INACTIF${NC}"
    fi

    # USBMuxd
    if systemctl is-active --quiet usbmuxd; then
        echo -e "  USBMuxd (USB)   : ${GREEN}ACTIF${NC}"
    else
        echo -e "  USBMuxd (USB)   : ${RED}INACTIF${NC}"
    fi

    # Avahi
    if systemctl is-active --quiet avahi-daemon; then
        echo -e "  Avahi (Bonjour) : ${GREEN}ACTIF${NC}"
    else
        echo -e "  Avahi (Bonjour) : ${RED}INACTIF${NC}"
    fi
}

function test_usb() {
    header
    echo -e "${YELLOW}[ TEST DÉTECTION USB ]${NC}"
    echo -e "1. Liste brute (lsusb) :"
    lsusb | grep -i "Apple" || echo "  Aucun iPhone détecté physiquement en USB."
    echo ""
    echo -e "2. Liste des UDIDs (idevice_id) :"
    idevice_id -l || echo "  Impossible de lire les UDIDs."
    echo ""
    echo -e "3. Diagnostic go-ios :"
    ios list
    wait_key
}

function pair_iphone() {
    header
    echo -e "${YELLOW}[ APPAIRAGE IPHONE (TRUST) ]${NC}"
    echo -e "${BLUE}Regarde ton iPhone et clique sur 'Se fier à cet ordinateur' s'il le demande.${NC}"
    echo ""
    idevicepair pair
    wait_key
}

function test_mdns() {
    header
    echo -e "${YELLOW}[ TEST DÉTECTION BONJOUR (WiFi) ]${NC}"
    echo -e "Scan en cours... ${BLUE}(Ctrl+C pour arrêter)${NC}"
    echo ""
    avahi-browse -rt _apple-mobdev2._tcp
    wait_key
}

function update_app() {
    header
    echo -e "${YELLOW}[ MISE À JOUR DES DÉPENDANCES ]${NC}"
    cd $APP_DIR/server && npm install --production
    sudo systemctl restart $SERVICE_NAME
    echo -e "${GREEN}Terminé !${NC}"
    wait_key
}

function show_logs() {
    header
    echo -e "${YELLOW}[ LOGS EN TEMPS RÉEL ]${NC}"
    echo -e "${BLUE}(Ctrl+C pour revenir au menu)${NC}"
    echo ""
    sudo journalctl -u $SERVICE_NAME -f
}

# Menu principal
while true; do
    check_status
    echo ""
    echo "1) Démarrer le serveur"
    echo "2) Arrêter le serveur"
    echo "3) Redémarrer le serveur"
    echo "4) Voir les logs en temps réel"
    echo "5) Tester la détection USB (UDID)"
    echo "6) Appairer l'iPhone (Trust/Pair)"
    echo "7) Tester la détection Bonjour (WiFi)"
    echo "8) Mettre à jour (NPM Install)"
    echo "q) Quitter"
    echo ""
    read -p "Choix : " choice

    case $choice in
        1) sudo systemctl start $SERVICE_NAME ;;
        2) sudo systemctl stop $SERVICE_NAME ;;
        3) sudo systemctl restart $SERVICE_NAME ;;
        4) show_logs ;;
        5) test_usb ;;
        6) pair_iphone ;;
        7) test_mdns ;;
        8) update_app ;;
        q) clear; exit 0 ;;
        *) echo -e "${RED}Choix invalide${NC}"; sleep 1 ;;
    esac
done
