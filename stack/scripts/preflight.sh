#!/usr/bin/env bash
set -euo pipefail

PORT="${ZOTERO20_HOST_PORT:-8089}"

echo "=== Wszystkie kontenery (nie modyfikujemy) ==="
docker ps -a --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'

echo ""
echo "=== Port ${PORT} (zotero20 / tunel CF) ==="
ss -tlnp 2>/dev/null | grep ":${PORT}" || echo "(wolny — OK)"

echo ""
echo "=== Twoje inne usługi (referencja) ==="
echo "  jf.keyweb.pl  → :8096"
echo "  fb.keyweb.pl  → :8088"
echo "  zotero.keyweb.pl → :8089  ← ten stack"

echo ""
docker ps -a --filter "name=zotero20" --format 'table {{.Names}}\t{{.Status}}' || true
