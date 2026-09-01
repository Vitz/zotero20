#!/usr/bin/env bash
set -euo pipefail

BASE="${ZOTERO_BASE:-http://127.0.0.1:${ZOTERO20_HOST_PORT:-8089}}"
API_KEY="${ZOTERO20_API_KEY:-}"

if [ -z "$API_KEY" ]; then
  [ -f .env ] && source .env
fi
if [ -z "$API_KEY" ]; then
  echo "Ustaw ZOTERO20_API_KEY"
  exit 1
fi

HDR=(-H "X-API-Key: $API_KEY")

echo "== ping ${BASE}/connector/ping =="
curl -sS -f "${HDR[@]}" "$BASE/connector/ping"
echo

echo "== health =="
curl -sS "$BASE/api/v1/health"
echo

echo "== studies / collections (wymaga X-API-Key) =="
STUDIES_JSON=$(curl -sS "${HDR[@]}" "$BASE/api/v1/studies")
echo "$STUDIES_JSON"
if echo "$STUDIES_JSON" | grep -q '"zotero_collections"'; then
  echo "Endpoint studies + zotero_collections OK"
elif echo "$STUDIES_JSON" | grep -q '"studies"'; then
  echo "Endpoint studies OK"
else
  echo "BŁĄD: endpoint /api/v1/studies nie odpowiada poprawnie"
  exit 1
fi

COLLECTIONS_JSON=$(curl -sS "${HDR[@]}" "$BASE/api/v1/collections" 2>/dev/null || true)
if [ -n "$COLLECTIONS_JSON" ]; then
  echo "== collections =="
  echo "$COLLECTIONS_JSON"
fi
echo

echo "OK"
