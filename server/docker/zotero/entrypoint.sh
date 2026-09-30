#!/bin/bash
set -euo pipefail

PROFILE_DIR="${ZOTERO_PROFILE}"
PREFS_FILE="${PROFILE_DIR}/prefs.js"
EXT_DIR="${PROFILE_DIR}/extensions"

mkdir -p "${PROFILE_DIR}" "${EXT_DIR}"
chown -R zotero:zotero /home/zotero

if [ ! -f "${PREFS_FILE}" ]; then
  gosu zotero bash -c "cat /zotero-prefs.js >> '${PREFS_FILE}'"
  echo "Utworzono prefs.js z włączonym Local API (:23119)."
fi

gosu zotero /install-api-plus.sh || echo "WARN: zotero-api-plus install skipped"

echo "Starting Xvfb on ${DISPLAY}..."
gosu zotero Xvfb "${DISPLAY}" -screen 0 1280x1024x24 -nolisten tcp &
sleep 2

echo "Starting Zotero..."
gosu zotero /opt/zotero/zotero -no-remote -profile "${PROFILE_DIR}" &
ZPID=$!

echo "Waiting for Zotero API on :23119..."
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:23119/connector/ping" >/dev/null 2>&1; then
    echo "Zotero API ready (attempt ${i})."
    break
  fi
  if ! kill -0 "${ZPID}" 2>/dev/null; then
    echo "Zotero process exited unexpectedly."
    exit 1
  fi
  sleep 2
done

if ! curl -fsS "http://127.0.0.1:23119/connector/ping" >/dev/null 2>&1; then
  echo "ERROR: Zotero API did not become ready in time."
  exit 1
fi

wait "${ZPID}"
