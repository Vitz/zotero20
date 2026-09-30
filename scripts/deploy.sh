#!/usr/bin/env bash
# Bezpieczny deploy na RPi — tylko stack zotero20, bez build, bez prune.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="${ROOT}/server"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zotero20}"

cd "${SERVER}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${ZOTERO20_IMAGE_ZOTERO:-}" ] || [ -z "${ZOTERO20_IMAGE_DJANGO:-}" ]; then
  echo "Błąd: ustaw ZOTERO20_IMAGE_ZOTERO i ZOTERO20_IMAGE_DJANGO w server/.env"
  exit 1
fi

compose() {
  docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" "$@"
}

echo "== preflight (nie ruszamy innych kontenerów) =="
docker ps --format 'table {{.Names}}\t{{.Status}}' | head -20 || true
echo "Projekt compose: ${PROJECT_NAME}"

if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
  echo "${GHCR_PULL_TOKEN}" | docker login ghcr.io -u "${GHCR_PULL_USER:-github}" --password-stdin
fi

echo "== pull images =="
compose pull zotero django

PROFILE_ARGS=()
if [ "${ZOTERO20_ENABLE_CLOUDFLARED:-1}" = "1" ]; then
  PROFILE_ARGS+=(--profile cloudflared)
  compose pull cloudflared || true
fi

echo "== up (tylko zotero20, --no-build) =="
compose "${PROFILE_ARGS[@]}" up -d --no-build --remove-orphans

echo "== migrate =="
compose exec -T django python manage.py migrate --noinput

echo "== health =="
PORT="${ZOTERO20_HOST_PORT:-8089}"
curl -fsS "http://127.0.0.1:${PORT}/api/v1/health"
echo

echo "Deploy OK — kontenery zotero20:"
compose ps
