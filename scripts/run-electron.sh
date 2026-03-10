#!/usr/bin/env bash
# Portable launcher that prefers the project's local Electron, with a safe fallback
# to a pinned Electron v36 on macOS if node_modules isn't installed.
# Usage: bash ./scripts/run-electron.sh <entry>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRY_PATH_REL="${1:-src/electron/main.js}"
ENTRY_PATH_ABS="$ROOT_DIR/$ENTRY_PATH_REL"

# 1) Prefer local Electron from node_modules if available
LOCAL_ELECTRON="$ROOT_DIR/node_modules/.bin/electron"
if [[ -x "$LOCAL_ELECTRON" ]]; then
  ELECTRON_ENABLE_LOGGING=${ELECTRON_ENABLE_LOGGING:-1} \
  ELECTRON_ENABLE_STACK_DUMPING=${ELECTRON_ENABLE_STACK_DUMPING:-1} \
  exec "$LOCAL_ELECTRON" "$ENTRY_PATH_ABS"
fi

# 2) Fallback: download and run Electron v36 for current macOS arch
OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
if [[ "$OS_NAME" != "Darwin" ]]; then
  echo "This fallback launcher currently supports macOS only. Install deps with 'npm install' instead." >&2
  exit 1
fi

VERSION="36.3.2"
CACHE_DIR="$ROOT_DIR/.cache/electron$VERSION"
APP_DIR="$CACHE_DIR/Electron.app"
BIN_PATH="$APP_DIR/Contents/MacOS/Electron"

if [[ "$ARCH_NAME" == "arm64" ]]; then
  ASSET="electron-v${VERSION}-darwin-arm64.zip"
elif [[ "$ARCH_NAME" == "x86_64" ]]; then
  ASSET="electron-v${VERSION}-darwin-x64.zip"
else
  echo "Unsupported macOS architecture: $ARCH_NAME" >&2
  exit 1
fi

URL="https://github.com/electron/electron/releases/download/v${VERSION}/${ASSET}"
ZIP_PATH="$CACHE_DIR/${ASSET}"

mkdir -p "$CACHE_DIR"
if [[ ! -x "$BIN_PATH" ]]; then
  echo "Fetching Electron $VERSION ($ARCH_NAME) from GitHub releases..."
  curl -L -o "$ZIP_PATH" "$URL"
  rm -rf "$APP_DIR"
  unzip -q -o "$ZIP_PATH" 'Electron.app/*' -d "$CACHE_DIR"
fi

if [[ ! -x "$BIN_PATH" ]]; then
  echo "Failed to prepare Electron binary at $BIN_PATH" >&2
  exit 1
fi

ELECTRON_ENABLE_LOGGING=${ELECTRON_ENABLE_LOGGING:-1} \
ELECTRON_ENABLE_STACK_DUMPING=${ELECTRON_ENABLE_STACK_DUMPING:-1} \
exec "$BIN_PATH" "$ENTRY_PATH_ABS"