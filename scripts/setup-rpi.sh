#!/usr/bin/env bash
# Szybki deploy na RPi5 (Docker)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="${REPO_DIR}/server"

echo "== zotero20 setup RPi =="

if [ ! -f "${SERVER_DIR}/.env" ]; then
  cp "${SERVER_DIR}/.env.example" "${SERVER_DIR}/.env"
  echo "Utworzono ${SERVER_DIR}/.env — uzupełnij DJANGO_SECRET_KEY."
fi

if [ ! -f "${SERVER_DIR}/django/config/studies.yaml" ]; then
  cp "${SERVER_DIR}/django/config/studies.yaml.example" "${SERVER_DIR}/django/config/studies.yaml"
  echo "Utworzono studies.yaml — uzupełnij collection_key po starcie Zotero."
fi

if [ ! -f "${SERVER_DIR}/cloudflared/config.yml" ]; then
  cp "${SERVER_DIR}/cloudflared/config.yml.example" "${SERVER_DIR}/cloudflared/config.yml"
  echo "Skopiuj credentials tunelu do server/cloudflared/"
fi

cd "${SERVER_DIR}"
docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo "Po starcie pobierz collection keys:"
echo "  curl -s http://127.0.0.1:23119/api/users/0/collections | jq"
echo ""
echo "Smoke test:"
echo "  ZOTERO_BASE=http://127.0.0.1:23119 ${REPO_DIR}/scripts/test-zotero-api.sh"
