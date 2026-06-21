#!/usr/bin/env bash
# gpsmock-ctl.sh — install and manage the GPS-Mock headless engine as a systemd
# service on Linux.
#
# Usage:
#   sudo ./gpsmock-ctl.sh install [--driver D] [--transport T] [--addr :8080]
#                                 [--rsd host:port] [--goios-bin PATH]
#                                 [--python-bin PATH] [--binary PATH]
#   sudo ./gpsmock-ctl.sh start|stop|restart|uninstall
#        ./gpsmock-ctl.sh status|logs|config
set -euo pipefail

SERVICE=gpsmock
UNIT="/etc/systemd/system/${SERVICE}.service"
ENV_DIR="/etc/gpsmock"
ENV_FILE="${ENV_DIR}/gpsmock.env"
BIN_DST="/usr/local/bin/gpsmock-engine"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "${SCRIPT_DIR}/../../engine" 2>/dev/null && pwd || true)"

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
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
  mkdir -p "${ENV_DIR}"

  cat > "${ENV_FILE}" <<EOF
# GPS-Mock headless engine configuration (edit then: sudo systemctl restart ${SERVICE})
GPSMOCK_DRIVER=${DRIVER}
GPSMOCK_TRANSPORT=${TRANSPORT}
GPSMOCK_ADDR=${ADDR}
GPSMOCK_RSD=${RSD}
GPSMOCK_GOIOS_BIN=${GOIOS_BIN}
GPSMOCK_PYTHON_BIN=${PYTHON_BIN}
EOF
  chmod 0644 "${ENV_FILE}"

  cat > "${UNIT}" <<EOF
[Unit]
Description=GPS-Mock headless engine (v3)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
ExecStart=${BIN_DST}
Restart=on-failure
RestartSec=3
# USB drivers (go-ios / pymobiledevice3) typically need root + usbmuxd.

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE}"
  echo "installed and started '${SERVICE}'. Config: ${ENV_FILE}"
  systemctl --no-pager --lines=0 status "${SERVICE}" || true
}

cmd_uninstall() {
  need_root uninstall
  systemctl disable --now "${SERVICE}" 2>/dev/null || true
  rm -f "${UNIT}"
  systemctl daemon-reload
  echo "removed service '${SERVICE}'. (binary ${BIN_DST} and ${ENV_DIR} kept; delete manually if desired)"
}

case "${1:-}" in
  install)   shift; cmd_install "$@" ;;
  uninstall) cmd_uninstall ;;
  start)     need_root start;   systemctl start "${SERVICE}" ;;
  stop)      need_root stop;    systemctl stop "${SERVICE}" ;;
  restart)   need_root restart; systemctl restart "${SERVICE}" ;;
  status)    systemctl --no-pager status "${SERVICE}" ;;
  logs)      journalctl -u "${SERVICE}" -f --no-pager ;;
  config)    cat "${ENV_FILE}" 2>/dev/null || { echo "not installed."; exit 1; } ;;
  *)
    echo "usage: $0 {install|uninstall|start|stop|restart|status|logs|config} [options]" >&2
    echo "  install options: --driver --transport --addr --rsd --goios-bin --python-bin --binary" >&2
    exit 1 ;;
esac
