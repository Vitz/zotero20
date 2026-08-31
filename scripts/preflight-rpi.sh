#!/usr/bin/env bash
# Sprawdzenie przed pierwszym deploy — nie modyfikuje nic.
set -euo pipefail

echo "=== Docker na hoście (wszystkie kontenery) ==="
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'

PORT="${ZOTERO20_HOST_PORT:-8089}"

echo ""
echo "=== Port 127.0.0.1:${PORT} (zotero20 / tunel CF) ==="
if command -v ss >/dev/null 2>&1; then
  ss -tlnp | grep ":${PORT}" || echo "(wolny)"
elif command -v netstat >/dev/null 2>&1; then
  netstat -tlnp 2>/dev/null | grep ":${PORT}" || echo "(wolny)"
else
  echo "(pomiń — brak ss/netstat)"
fi

echo ""
echo "=== Istniejące projekty compose zotero20 ==="
docker ps -a --filter "name=zotero20" --format 'table {{.Names}}\t{{.Status}}' || true

echo ""
echo "=== Wolumeny zotero20 ==="
docker volume ls | grep zotero20 || echo "(brak — OK przy pierwszym deploy)"

echo ""
echo "Jeśli port ${PORT} zajęty — zmień ZOTERO20_HOST_PORT w .env i route w CF"
echo "Jeśli masz już cloudflared — ustaw ZOTERO20_ENABLE_CLOUDFLARED=0 w server/.env"
