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

echo "== admin static (CSS) =="
curl -sS -f -o /dev/null -w "HTTP %{http_code}\n" "$BASE/static/admin/css/base.css"

echo "== admin login page =="
curl -sS -f -o /dev/null -w "HTTP %{http_code}\n" "$BASE/app/login/"

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
  if echo "$COLLECTIONS_JSON" | grep -q '"source": "web"'; then
    echo "collections source: web (zotero.org) OK"
  elif echo "$COLLECTIONS_JSON" | grep -q '"source": "local"'; then
    echo "UWAGA: collections source=local — brak ZOTERO_WEB_API_KEY lub Web API niedostępne"
    if [ "${REQUIRE_WEB_API:-0}" = "1" ]; then
      echo "BŁĄD: wymagany source=web (ustaw REQUIRE_WEB_API=0 aby pominąć)"
      exit 1
    fi
  fi
fi

if [ "${SMOKE_TEST_DOI_IMPORT:-0}" = "1" ]; then
  COLL_KEY="${SMOKE_TEST_COLLECTION_KEY:-}"
  if [ -z "$COLL_KEY" ] && command -v python3 >/dev/null; then
    COLL_KEY=$(echo "$COLLECTIONS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['collections'][0]['key'] if d.get('collections') else '')" 2>/dev/null || true)
  fi
  if [ -n "$COLL_KEY" ]; then
    echo "== import/doi smoke (collection_key=$COLL_KEY) =="
    IMPORT_JSON=$(curl -sS -w "\nHTTP_CODE:%{http_code}" "${HDR[@]}" \
      -H "Content-Type: application/json" \
      -d "{\"doi\":\"10.1038/nature12373\",\"collection_key\":\"$COLL_KEY\"}" \
      "$BASE/api/v1/import/doi")
    echo "$IMPORT_JSON"
    if ! echo "$IMPORT_JSON" | grep -q 'HTTP_CODE:200'; then
      echo "BŁĄD: import/doi nie zwrócił HTTP 200"
      exit 1
    fi
    echo "import/doi OK"
  else
    echo "Pominięto import/doi — brak collection_key"
  fi
fi
echo

echo "OK"
