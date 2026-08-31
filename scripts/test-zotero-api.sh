#!/usr/bin/env bash
# Smoke test — Django gateway (jeden host, X-API-Key).
set -euo pipefail

BASE="${ZOTERO_BASE:-http://127.0.0.1:8000}"
API_KEY="${ZOTERO20_API_KEY:-}"

if [[ -z "$API_KEY" ]]; then
  echo "Ustaw ZOTERO20_API_KEY (nagłówek X-API-Key)."
  exit 1
fi

HDR=(-H "X-API-Key: $API_KEY")

echo "== Zotero ping via gateway (${BASE}/connector/ping) =="
curl -sS -f "${HDR[@]}" "$BASE/connector/ping"
echo

echo "== api-plus health =="
curl -sS "${HDR[@]}" "$BASE/api/plus/health" || echo "(api-plus może nie być zainstalowane)"
echo

echo "== Django health (bez klucza — publiczny) =="
curl -sS "$BASE/api/v1/health"
echo

echo "== Django studies (z kluczem) =="
curl -sS "${HDR[@]}" "$BASE/api/v1/studies"
echo

echo "OK"
