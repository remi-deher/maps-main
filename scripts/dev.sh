#!/bin/bash
set -e

# Get the script directory and root directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_APP_DIR="$ROOT_DIR/tauri-app"

# 1. Build sidecar first
echo "Checking/Building Tauri sidecar..."

# Determine rust target triple
if ! command -v rustc &> /dev/null; then
    echo "Error: rustc is not installed or not in PATH."
    exit 1
fi

TARGET_TRIPLE=$(rustc -vV | grep "host:" | cut -d' ' -f2)
echo "Detected target triple: $TARGET_TRIPLE"

BINARIES_DIR="$TAURI_APP_DIR/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

OUTPUT_NAME="gpsmock-engine-$TARGET_TRIPLE"
OUTPUT_PATH="$BINARIES_DIR/$OUTPUT_NAME"

echo "Building Go engine to sidecar path..."
if ! command -v go &> /dev/null; then
    echo "Error: go is not installed or not in PATH."
    exit 1
fi

cd "$ROOT_DIR/engine"
go build -o "$OUTPUT_PATH" ./cmd/headless

echo "Sidecar binary created successfully at: $OUTPUT_PATH"

# 2. Run Tauri dev
echo "Starting Tauri application in dev mode..."
cd "$TAURI_APP_DIR"
npm run tauri dev
