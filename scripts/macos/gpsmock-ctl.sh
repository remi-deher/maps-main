#!/usr/bin/env bash
# gpsmock-ctl.sh — install and manage the GPS-Mock headless engine as a
# launchd daemon on macOS. Mirrors scripts/linux/gpsmock-ctl.sh (systemd) and
# scripts/windows/gpsmock-ctl.ps1 (Windows service) — same verbs, same flags.
#
# Usage:
#   sudo ./gpsmock-ctl.sh install [--driver D] [--transport T] [--addr :8080]
#                                 [--rsd host:port] [--goios-bin PATH]
#                                 [--python-bin PATH] [--binary PATH]
#   sudo ./gpsmock-ctl.sh start|stop|restart|uninstall
#        ./gpsmock-ctl.sh status|logs|config
set -euo pipefail

LABEL="com.remi2.gpsmock"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
BIN_DST="/usr/local/bin/gpsmock-engine"
LOG_DIR="/var/log/gpsmock"
LOG_FILE="${LOG_DIR}/engine.log"
ENV_FILE="/etc/gpsmock/gpsmock.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "${SCRIPT_DIR}/../../engine" 2>/dev/null && pwd || true)"

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "error: '$1' requires root (use sudo)." >&2
    exit 1
  fi
}

# Defaults (overridable via flags on install)
DRIVER="pymobiledevice"
TRANSPORT="auto"
ADDR=":8080"
RSD=""
GOIOS_BIN=""
PYTHON_BIN=""
BINARY=""

parse_opts() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --driver)     DRIVER="$2"; shift 2 ;;
      --transport)  TRANSPORT="$2"; shift 2 ;;
      --addr)       ADDR="$2"; shift 2 ;;
      --rsd)        RSD="$2"; shift 2 ;;
      --goios-bin)  GOIOS_BIN="$2"; shift 2 ;;
      --python-bin) PYTHON_BIN="$2"; shift 2 ;;
      --binary)     BINARY="$2"; shift 2 ;;
      *) echo "unknown option: $1" >&2; exit 1 ;;
    esac
  done
}

resolve_binary() {
  # Priority: explicit --binary, prebuilt engine/bin, else build from source.
  if [[ -n "${BINARY}" ]]; then
    echo "${BINARY}"; return
  fi
  if [[ -n "${ENGINE_DIR}" && -x "${ENGINE_DIR}/bin/headless" ]]; then
    echo "${ENGINE_DIR}/bin/headless"; return
  fi
  if [[ -n "${ENGINE_DIR}" ]] && command -v go >/dev/null 2>&1; then
    echo "building engine from source..." >&2
    ( cd "${ENGINE_DIR}" && go build -o bin/headless ./cmd/headless ) >&2
    echo "${ENGINE_DIR}/bin/headless"; return
  fi
  echo "error: no binary found and cannot build (provide --binary PATH or install Go)." >&2
  exit 1
}

cmd_install() {
  need_root install
  parse_opts "$@"
  local src; src="$(resolve_binary)"

  install -m 0755 "${src}" "${BIN_DST}"
  mkdir -p "$(dirname "${ENV_FILE}")" "${LOG_DIR}"

  # Kept alongside the plist for `config`/manual inspection — launchd itself
  # reads the values from EnvironmentVariables below (no EnvironmentFile
  # support), so this file is regenerated on every install but only the
  # plist actually drives the daemon.
  cat > "${ENV_FILE}" <<EOF
# GPS-Mock headless engine configuration (edit then: sudo ./gpsmock-ctl.sh install ... to regenerate, or sudo launchctl kickstart -k system/${LABEL})
GPSMOCK_DRIVER=${DRIVER}
GPSMOCK_TRANSPORT=${TRANSPORT}
GPSMOCK_ADDR=${ADDR}
GPSMOCK_RSD=${RSD}
GPSMOCK_GOIOS_BIN=${GOIOS_BIN}
GPSMOCK_PYTHON_BIN=${PYTHON_BIN}
EOF
  chmod 0644 "${ENV_FILE}"

  # Unload any existing instance before rewriting the plist (reinstall path).
  launchctl bootout system "${PLIST}" 2>/dev/null || true

  cat > "${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN_DST}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GPSMOCK_DRIVER</key>
    <string>${DRIVER}</string>
    <key>GPSMOCK_TRANSPORT</key>
    <string>${TRANSPORT}</string>
    <key>GPSMOCK_ADDR</key>
    <string>${ADDR}</string>
    <key>GPSMOCK_RSD</key>
    <string>${RSD}</string>
    <key>GPSMOCK_GOIOS_BIN</key>
    <string>${GOIOS_BIN}</string>
    <key>GPSMOCK_PYTHON_BIN</key>
    <string>${PYTHON_BIN}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
EOF
  chmod 0644 "${PLIST}"

  launchctl bootstrap system "${PLIST}"
  launchctl enable "system/${LABEL}"
  echo "installed and started '${LABEL}'. Config: ${ENV_FILE} (regenerate via install to change)"
  sleep 1
  launchctl print "system/${LABEL}" 2>/dev/null | head -5 || true
}

cmd_uninstall() {
  need_root uninstall
  launchctl bootout system "${PLIST}" 2>/dev/null || true
  rm -f "${PLIST}"
  echo "removed daemon '${LABEL}'. (binary ${BIN_DST}, ${ENV_FILE} and ${LOG_FILE} kept; delete manually if desired)"
}

cmd_status() {
  if launchctl print "system/${LABEL}" >/dev/null 2>&1; then
    launchctl print "system/${LABEL}" | grep -E "state|pid" || true
  else
    echo "not installed or not running."
    exit 1
  fi
}

case "${1:-}" in
  install)   shift; cmd_install "$@" ;;
  uninstall) cmd_uninstall ;;
  start)     need_root start;   launchctl kickstart -k "system/${LABEL}" ;;
  stop)      need_root stop;    launchctl kill TERM "system/${LABEL}" ;;
  restart)   need_root restart; launchctl kickstart -k "system/${LABEL}" ;;
  status)    cmd_status ;;
  logs)      tail -f "${LOG_FILE}" ;;
  config)    cat "${ENV_FILE}" 2>/dev/null || { echo "not installed."; exit 1; } ;;
  *)
    echo "usage: $0 {install|uninstall|start|stop|restart|status|logs|config} [options]" >&2
    echo "  install options: --driver --transport --addr --rsd --goios-bin --python-bin --binary" >&2
    exit 1 ;;
esac
