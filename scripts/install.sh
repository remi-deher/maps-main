#!/usr/bin/env bash
# install.sh — GPS-Mock bootstrapper for Linux/macOS.
#
# Always resolves the *latest* GitHub release at run time (never bundles a
# version itself), asks which variant to install, downloads only that one
# asset, and offers to register it as an OS service (headless variant).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/remi-deher/maps-main/main/scripts/install.sh | bash
#   ./install.sh [--variant headless|desktop] [--service] [--dest DIR]
set -euo pipefail

REPO="remi-deher/maps-main"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"
DEST_DIR=""
VARIANT=""
WANT_SERVICE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --variant) VARIANT="$2"; shift 2 ;;
    --service) WANT_SERVICE="yes"; shift ;;
    --dest)    DEST_DIR="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

case "$(uname -s)" in
  Linux)  OS="linux" ;;
  Darwin) OS="darwin" ;;
  *) echo "error: unsupported OS ($(uname -s)). Use the Windows installer (install.ps1) instead." >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "error: unsupported architecture ($(uname -m))." >&2; exit 1 ;;
esac

echo "Recherche de la dernière version sur GitHub (${REPO})..."
RELEASE_JSON="$(curl -fsSL "${API_URL}")"
TAG="$(printf '%s' "${RELEASE_JSON}" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/')"
if [[ -z "${TAG}" ]]; then
  echo "error: impossible de déterminer la dernière version (réponse GitHub inattendue)." >&2
  exit 1
fi
echo "Dernière version : ${TAG}"

# Extracts the browser_download_url whose asset name matches a glob, without
# requiring jq — releases/latest's JSON has one "name"/"browser_download_url"
# pair per asset, in order, so pairing the two greps positionally is reliable
# enough for this fixed asset-naming scheme.
asset_url() {
  local pattern="$1"
  printf '%s' "${RELEASE_JSON}" \
    | grep -E '"(name|browser_download_url)":' \
    | paste -d' ' - - \
    | grep -E "\"name\": \"${pattern}\"" \
    | sed -E 's/.*"browser_download_url": "([^"]+)".*/\1/' \
    | head -1
}

if [[ -z "${VARIANT}" ]]; then
  echo ""
  echo "Quelle variante installer ?"
  echo "  1) Moteur headless + UI web (un seul binaire, serveur/automatisation)"
  echo "  2) Application desktop complète (interface native, Tauri)"
  read -r -p "Choix [1/2] : " choice
  case "${choice}" in
    1) VARIANT="headless" ;;
    2) VARIANT="desktop" ;;
    *) echo "choix invalide." >&2; exit 1 ;;
  esac
fi

if [[ "${VARIANT}" == "headless" ]]; then
  # Stop any running engine or drivers
  echo "Arrêt des processus GPS-Mock en cours..."
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "gpsmock-engine" || true
    pkill -f "gpsmock.*ios" || true
    pkill -f "gpsmock.*python" || true
  else
    killall gpsmock-engine 2>/dev/null || true
    killall ios 2>/dev/null || true
    killall python 2>/dev/null || true
    killall python3 2>/dev/null || true
  fi
  sleep 0.5

  DEST_DIR="${DEST_DIR:-/usr/local/bin}"
  ASSET_NAME="gpsmock-engine-${OS}-${ARCH}"
  url="$(asset_url "${ASSET_NAME}")"
  if [[ -z "${url}" ]]; then
    echo "error: aucun asset '${ASSET_NAME}' trouvé dans la release ${TAG}." >&2
    exit 1
  fi
  echo "Téléchargement de ${ASSET_NAME} (${TAG})..."
  tmp="$(mktemp)"
  curl -fsSL "${url}" -o "${tmp}"
  chmod +x "${tmp}"

  dest="${DEST_DIR}/gpsmock-engine"
  if [[ -w "${DEST_DIR}" ]]; then
    mv "${tmp}" "${dest}"
  else
    echo "Installation dans ${DEST_DIR} (sudo requis)..."
    sudo mv "${tmp}" "${dest}"
  fi
  echo "Installé : ${dest}"

  if [[ -z "${WANT_SERVICE}" ]]; then
    read -r -p "Installer comme service système maintenant (démarrage auto) ? [y/N] " svc
    [[ "${svc}" =~ ^[Yy]$ ]] && WANT_SERVICE="yes"
  fi

  if [[ "${WANT_SERVICE}" == "yes" ]]; then
    ctl_path="$([[ "${OS}" == "linux" ]] && echo "linux/gpsmock-ctl.sh" || echo "macos/gpsmock-ctl.sh")"
    ctl_tmp="$(mktemp)"
    curl -fsSL "${RAW_BASE}/scripts/${ctl_path}" -o "${ctl_tmp}"
    chmod +x "${ctl_tmp}"
    sudo "${ctl_tmp}" install --binary "${dest}"
    rm -f "${ctl_tmp}"
  else
    echo "Lancer manuellement : ${dest}"
  fi
else
  # Desktop bundle naming differs per OS (Tauri's bundler conventions).
  case "${OS}" in
    linux)  pattern="*_amd64.AppImage" ;;
    darwin) pattern="*_aarch64.dmg" ;;
  esac
  url="$(asset_url "${pattern}")"
  if [[ -z "${url}" ]]; then
    echo "error: aucun asset desktop (${pattern}) trouvé dans la release ${TAG}." >&2
    exit 1
  fi
  name="$(basename "${url}")"
  dest="${DEST_DIR:-${HOME}/Downloads}/${name}"
  echo "Téléchargement de ${name} (${TAG})..."
  mkdir -p "$(dirname "${dest}")"
  curl -fsSL "${url}" -o "${dest}"
  echo "Téléchargé : ${dest}"
  if [[ "${OS}" == "darwin" ]]; then
    open "${dest}"
  else
    chmod +x "${dest}"
    echo "Lancer : ${dest}"
  fi
fi
