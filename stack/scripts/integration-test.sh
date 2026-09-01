#!/usr/bin/env bash
# Pełny smoke test API + Connector przeciwko działającemu stackowi Docker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$STACK_DIR"

BASE="${ZOTERO_BASE:-http://127.0.0.1:${ZOTERO20_HOST_PORT:-8089}}"
API_KEY="${ZOTERO20_API_KEY:-}"
TEST_DOI="${SMOKE_TEST_DOI:-10.1038/nature12373}"

if [ -z "$API_KEY" ] && [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi
if [ -z "$API_KEY" ]; then
  echo "Ustaw ZOTERO20_API_KEY w .env lub środowisku"
  exit 1
fi

HDR=(-H "X-API-Key: $API_KEY")
FAIL=0

check() {
  local label="$1"
  shift
  echo ""
  echo "== $label =="
  if "$@"; then
    echo "OK: $label"
  else
    echo "FAIL: $label"
    FAIL=1
  fi
}

wait_healthy() {
  local max="${1:-300}"
  local i=0
  while [ "$i" -lt "$max" ]; do
    if curl -fsS "$BASE/api/v1/health" >/dev/null 2>&1; then
      echo "Stack healthy at $BASE"
      return 0
    fi
    i=$((i + 5))
    sleep 5
  done
  echo "Timeout: stack nie odpowiada na $BASE/api/v1/health"
  return 1
}

test_health() {
  curl -fsS "$BASE/api/v1/health" | tee /tmp/zotero20-health.json
  grep -q '"service"' /tmp/zotero20-health.json
}

test_ping() {
  local headers
  headers=$(curl -sS -D - -o /tmp/zotero20-ping.json "${HDR[@]}" "$BASE/connector/ping" 2>&1 | head -20)
  echo "$headers"
  cat /tmp/zotero20-ping.json
  echo
  echo "$headers" | grep -qi 'X-Zotero-Version:' || echo "$headers" | grep -qi '200'
}

test_collections() {
  curl -fsS "${HDR[@]}" "$BASE/api/v1/collections" | tee /tmp/zotero20-collections.json
  grep -q '"collections"' /tmp/zotero20-collections.json
}

test_styles() {
  curl -fsS "${HDR[@]}" "$BASE/api/v1/styles" | tee /tmp/zotero20-styles.json
  grep -q '"apa"' /tmp/zotero20-styles.json
}

test_import_doi() {
  local coll_key="${SMOKE_TEST_COLLECTION_KEY:-}"
  if [ -z "$coll_key" ] && [ -f /tmp/zotero20-collections.json ]; then
    coll_key=$(python3 -c "
import json
with open('/tmp/zotero20-collections.json') as f:
    d = json.load(f)
cols = d.get('collections') or []
print(cols[0]['key'] if cols else '')
" 2>/dev/null || true)
  fi
  if [ -z "$coll_key" ]; then
    echo "Pominięto import/doi — brak kolekcji"
    return 0
  fi
  local resp
  resp=$(curl -sS -w "\nHTTP_CODE:%{http_code}" "${HDR[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"doi\":\"$TEST_DOI\",\"collection_key\":\"$coll_key\"}" \
    "$BASE/api/v1/import/doi")
  echo "$resp" | sed '/HTTP_CODE:/d' > /tmp/zotero20-import.json
  echo "$resp"
  echo "$resp" | grep -q 'HTTP_CODE:200'
}

test_bibliography() {
  local coll_key item_key
  coll_key=$(python3 -c "
import json
try:
    with open('/tmp/zotero20-collections.json') as f:
        d = json.load(f)
    cols = d.get('collections') or []
    print(cols[0]['key'] if cols else '')
except Exception:
    print('')
" 2>/dev/null || true)
  item_key=$(python3 -c "
import json
try:
    with open('/tmp/zotero20-import.json') as f:
        d = json.load(f)
    print(d.get('item_key') or (d.get('result') or {}).get('key', ''))
except Exception:
    print('')
" 2>/dev/null || true)

  if [ -n "$item_key" ]; then
    curl -fsS "${HDR[@]}" "$BASE/api/v1/items/${item_key}?style=apa" | tee /tmp/zotero20-item.json
    curl -fsS "${HDR[@]}" -H "Content-Type: application/json" \
      -d "{\"item_keys\":[\"$item_key\"],\"style\":\"apa\"}" \
      "$BASE/api/v1/bibliography" | tee /tmp/zotero20-bib.json
    grep -q '"entries"' /tmp/zotero20-bib.json
  elif [ -n "$coll_key" ]; then
    curl -fsS "${HDR[@]}" -H "Content-Type: application/json" \
      -d "{\"collection_key\":\"$coll_key\",\"style\":\"apa\"}" \
      "$BASE/api/v1/bibliography" | tee /tmp/zotero20-bib.json
    grep -q '"entries"' /tmp/zotero20-bib.json
  else
    echo "Pominięto bibliography — brak item_key/collection_key"
    return 0
  fi
}

test_exec_command() {
  local resp
  resp=$(curl -sS -w "\nHTTP_CODE:%{http_code} TIME:%{time_total}" --max-time 45 \
    -X POST "${HDR[@]}" -H "Content-Type: application/json" -d '{}' \
    "$BASE/connector/document/execCommand" 2>&1 || true)
  echo "$resp"
  ! echo "$resp" | grep -q 'HTTP_CODE:502'
  ! echo "$resp" | grep -q 'HTTP_CODE:000'
}

echo "Integration tests → $BASE"
wait_healthy 300

check "GET /api/v1/health" test_health
check "GET /connector/ping" test_ping
check "GET /api/v1/collections" test_collections
check "GET /api/v1/styles" test_styles
check "POST /api/v1/import/doi" test_import_doi
check "POST /api/v1/bibliography + GET items" test_bibliography
check "POST /connector/document/execCommand" test_exec_command

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "INTEGRATION TESTS FAILED"
  exit 1
fi

echo ""
echo "ALL INTEGRATION TESTS PASSED"
