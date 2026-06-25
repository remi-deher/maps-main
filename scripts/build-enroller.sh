#!/bin/bash
# Script de build de l'exécutable autonome ios-enroller pour macOS / Linux

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ENROLLER_DIR="$SCRIPT_DIR/../ios-enroller"

echo "Dossier ios-enroller : $ENROLLER_DIR"

cd "$ENROLLER_DIR" || exit 1

# 1. Installation des dépendances NPM
echo "Vérification et installation des dépendances Node..."
npm install
if [ $? -ne 0 ]; then
    echo "Erreur: npm install a échoué"
    exit 1
fi

# 2. Détermination de la cible de compilation
OS_TYPE="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH_TYPE="$(uname -m)"

if [ "$ARCH_TYPE" = "x86_64" ]; then
    TARGET_ARCH="x64"
else
    TARGET_ARCH="arm64"
fi

if [ "$OS_TYPE" = "darwin" ]; then
    TARGET_OS="macos"
    OUTPUT_FILE="dist/ios-enroller-macos"
else
    TARGET_OS="linux"
    OUTPUT_FILE="dist/ios-enroller-linux"
fi

TARGET="node18-$TARGET_OS-$TARGET_ARCH"

# 3. Compilation
echo "Compilation de l'exécutable autonome pour la cible $TARGET..."
npx pkg . --targets "$TARGET" --output "$OUTPUT_FILE"
if [ $? -ne 0 ]; then
    echo "Erreur: la compilation avec pkg a échoué"
    exit 1
fi

echo -e "\n[SUCCÈS] L'exécutable autonome a été généré avec succès dans :"
echo "   -> ios-enroller/$OUTPUT_FILE"
