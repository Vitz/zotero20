#!/usr/bin/env bash
# Tworzy kolekcje „Badanie 1/2” przez Local API (wymaga włączonego Local API w Zotero).
set -euo pipefail

ZOTERO_BASE="${ZOTERO_BASE:-http://127.0.0.1:23119}"

create_collection() {
  local name="$1"
  curl -fsS -X POST "${ZOTERO_BASE}/api/users/0/collections" \
    -H "Content-Type: application/json" \
    -H "Zotero-API-Version: 3" \
    --data-binary "[{\"name\":\"${name}\",\"parentCollection\":false}]"
  echo
}

echo "Tworzenie kolekcji w Zotero..."
create_collection "Badanie 1" || true
create_collection "Badanie 2" || true

echo "Aktualne kolekcje:"
curl -fsS "${ZOTERO_BASE}/api/users/0/collections" | head -c 2000
echo
