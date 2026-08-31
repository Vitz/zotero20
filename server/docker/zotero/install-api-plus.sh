#!/bin/bash
set -euo pipefail

EXT_DIR="${ZOTERO_PROFILE}/extensions"
MARKER="${EXT_DIR}/.api-plus-installed"
XPI_URL="https://github.com/GOKORURI007/zotero-api-plus/releases/latest/download/zotero-api-plus.xpi"

if [ -f "${MARKER}" ]; then
  exit 0
fi

mkdir -p "${EXT_DIR}"
echo "Downloading zotero-api-plus..."
if curl -fsSL "${XPI_URL}" -o "${EXT_DIR}/zotero-api-plus.xpi"; then
  touch "${MARKER}"
  echo "zotero-api-plus downloaded to ${EXT_DIR}"
else
  echo "Could not download zotero-api-plus (will use Local API fallback in Django)."
  exit 0
fi
