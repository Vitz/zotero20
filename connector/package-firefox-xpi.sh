#!/usr/bin/env bash
# Package upstream/build/firefox/ as a loadable .xpi (zip of folder contents).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FF_DIR="${ROOT}/upstream/build/firefox"
XPI="${ROOT}/upstream/build/zotero20-connector-firefox.xpi"

if [ ! -f "${FF_DIR}/manifest.json" ]; then
  echo "Missing ${FF_DIR}/manifest.json — run build first." >&2
  exit 1
fi

rm -f "$XPI"
(cd "$FF_DIR" && zip -qr "$XPI" .)
echo "XPI: $XPI"
