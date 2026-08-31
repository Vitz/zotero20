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

echo "== studies (wymaga X-API-Key) =="
STUDIES_JSON=$(curl -sS "${HDR[@]}" "$BASE/api/v1/studies")
echo "$STUDIES_JSON"
if echo "$STUDIES_JSON" | grep -q '"studies"'; then
  CONFIGURED=$(echo "$STUDIES_JSON" | grep -o '"configured": true' | wc -l | tr -d ' ')
  if [ "${CONFIGURED:-0}" -eq 0 ]; then
    echo "UWAGA: brak skonfigurowanych badań (collection_key w studies.yaml)"
    exit 1
  fi
else
  echo "BŁĄD: endpoint /api/v1/studies nie zwrócił listy badań"
  exit 1
fi
echo

echo "OK"
