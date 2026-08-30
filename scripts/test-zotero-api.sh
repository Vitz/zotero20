#!/usr/bin/env bash
# Smoke test — uruchom na RPi (localhost) lub z zewnątrz (ustaw ZOTERO_BASE + CF headers).
set -euo pipefail

ZOTERO_BASE="${ZOTERO_BASE:-http://127.0.0.1:23119}"
CF_ID="${CF_ACCESS_CLIENT_ID:-}"
CF_SECRET="${CF_ACCESS_CLIENT_SECRET:-}"

CURL_OPTS=(-sS -f)
if [[ -n "$CF_ID" && -n "$CF_SECRET" ]]; then
  CURL_OPTS+=(-H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET")
fi

echo "== ping =="
curl "${CURL_OPTS[@]}" "$ZOTERO_BASE/connector/ping"
echo

echo "== api-plus health =="
curl "${CURL_OPTS[@]}" "$ZOTERO_BASE/api/plus/health" || echo "(api-plus może nie być zainstalowane)"
echo

echo "== collections (sample) =="
curl "${CURL_OPTS[@]}" "$ZOTERO_BASE/api/users/0/collections" | head -c 500
echo

echo "OK"
