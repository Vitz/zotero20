#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PORT="${ZOTERO20_HOST_PORT:-8089}"

if [ -z "${ZOTERO20_IMAGE_ZOTERO:-}" ] || [ -z "${ZOTERO20_IMAGE_DJANGO:-}" ]; then
  echo "Uzupełnij ZOTERO20_IMAGE_* w .env"
  exit 1
fi

if [ ! -f config/studies.yaml ]; then
  cp config/studies.yaml.example config/studies.yaml
  echo "Utworzono config/studies.yaml — uzupełnij collection_key."
fi

compose() {
  docker compose -p zotero20 -f docker-compose.yml "$@"
}

if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
  echo "${GHCR_PULL_TOKEN}" | docker login ghcr.io -u "${GHCR_PULL_USER:-github}" --password-stdin
fi

echo "== disk =="
df -h / | tail -1
docker system df 2>/dev/null || true

echo "== prune dangling images =="
docker image prune -f || true

echo "== pull =="
compose pull

echo "== up (bez build) =="
PROFILE_ARGS=()
if [ -n "${CLOUDFLARED_TUNNEL_TOKEN:-}" ]; then
  PROFILE_ARGS+=(--profile cloudflared)
fi
compose "${PROFILE_ARGS[@]}" up -d --no-build --remove-orphans

echo "== migrate =="
compose exec -T django python manage.py migrate --noinput --fake-initial

echo "== health :${PORT} =="
curl -fsS "http://127.0.0.1:${PORT}/api/v1/health"
echo

compose ps
echo "OK"
