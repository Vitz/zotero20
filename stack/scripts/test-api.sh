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
PING_HEADERS=$(curl -sS -D - -o /tmp/zotero20-ping.json "${HDR[@]}" "$BASE/connector/ping" 2>&1 | head -20)
echo "$PING_HEADERS"
if ! echo "$PING_HEADERS" | grep -qi 'X-Zotero-Version:'; then
  echo "BŁĄD: /connector/ping bez nagłówka X-Zotero-Version — Connector pokaże „Zotero is offline”"
  exit 1
fi
cat /tmp/zotero20-ping.json
echo

echo "== document/execCommand reachability (expect 4xx, not 502) =="
DOC_RESP=$(curl -sS -w "\nHTTP_CODE:%{http_code} TIME:%{time_total}" --max-time 45 \
  -X POST "${HDR[@]}" -H "Content-Type: application/json" -d '{}' \
  "$BASE/connector/document/execCommand" 2>&1 || true)
echo "$DOC_RESP"
if echo "$DOC_RESP" | grep -q 'HTTP_CODE:502'; then
  echo "BŁĄD: document/execCommand zwrócił 502 — Zotero Desktop niedostępny lub timeout proxy"
  exit 1
fi
if echo "$DOC_RESP" | grep -q 'HTTP_CODE:000'; then
  echo "BŁĄD: document/execCommand timeout — zwiększ ZOTERO_PROXY_DOCUMENT_TIMEOUT"
  exit 1
fi
echo "document/execCommand proxy OK (Zotero odpowiedział)"

echo "== health =="
curl -sS "$BASE/api/v1/health"
echo

echo "== styles =="
STYLES_JSON=$(curl -sS "${HDR[@]}" "$BASE/api/v1/styles")
echo "$STYLES_JSON"
if ! echo "$STYLES_JSON" | grep -q '"apa"'; then
  echo "BŁĄD: /api/v1/styles nie zawiera stylu apa"
  exit 1
fi

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

if [ "${SMOKE_TEST_BIBLIOGRAPHY:-1}" != "0" ] && [ -n "$COLLECTIONS_JSON" ]; then
  COLL_KEY="${SMOKE_TEST_COLLECTION_KEY:-}"
  if [ -z "$COLL_KEY" ] && command -v python3 >/dev/null; then
    COLL_KEY=$(echo "$COLLECTIONS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['collections'][0]['key'] if d.get('collections') else '')" 2>/dev/null || true)
  fi
  if [ -n "$COLL_KEY" ]; then
    echo "== bibliography smoke (collection_key=$COLL_KEY) =="
    BIB_JSON=$(curl -sS -w "\nHTTP_CODE:%{http_code}" "${HDR[@]}" \
      -H "Content-Type: application/json" \
      -d "{\"collection_key\":\"$COLL_KEY\",\"style\":\"apa\"}" \
      "$BASE/api/v1/bibliography")
    echo "$BIB_JSON"
    if ! echo "$BIB_JSON" | grep -q 'HTTP_CODE:200'; then
      echo "UWAGA: bibliography collection zwrócił != 200 (może pusta kolekcja)"
    else
      echo "bibliography OK"
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
