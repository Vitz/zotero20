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

echo "== down (zwalnia stare obrazy przed pull) =="
compose down --remove-orphans || true

# Obcy kontener trzymający :PORT przejąłby ruch z Caddy, a compose i tak zgłosiłby sukces.
echo "== kontrola właściciela portu ${PORT} =="
FOREIGN=$(docker ps -a --format '{{.Names}}\t{{.Ports}}\t{{.Label "com.docker.compose.project"}}' \
  | awk -F'\t' -v port=":${PORT}->" '$2 ~ port && $3 != "zotero20" {print $1" (projekt: "($3==""?"brak":$3)")"}')
if [ -n "${FOREIGN}" ]; then
  echo "BŁĄD: port ${PORT} publikują kontenery spoza projektu zotero20:"
  echo "${FOREIGN}"
  echo "Usuń je (docker rm -f <nazwa>) — inaczej deploy aktualizuje stack, a ruch obsługuje stary kontener."
  exit 1
fi

echo "== prune build cache =="
docker builder prune -af || true

echo "== prune unused images =="
docker image prune -af || true

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
# Gunicorn na RPi potrzebuje kilkunastu sekund — bez ponowień deploy wywala się
# na wyścigu, mimo że kontenery wstały poprawnie.
HEALTH_BODY=""
for attempt in $(seq 1 30); do
  HEALTH_BODY=$(curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/api/v1/health" || true)
  if [ -n "${HEALTH_BODY}" ]; then
    break
  fi
  echo "health: próba ${attempt}/30 nieudana, czekam 5s…"
  sleep 5
done
if [ -z "${HEALTH_BODY}" ]; then
  echo "BŁĄD: /api/v1/health nie odpowiedział po ~150s"
  compose logs django --tail 80 || true
  exit 1
fi
echo "${HEALTH_BODY}"

# Kontener mógł wstać ze starego obrazu (cache, ręczny docker run) — health "ok" tego nie wyłapie.
if [ "${HEALTH_BODY#*"${ZOTERO20_IMAGE_DJANGO}"}" = "${HEALTH_BODY}" ]; then
  echo "BŁĄD: :${PORT} serwuje inny build niż wdrażany"
  echo "  oczekiwano: ${ZOTERO20_IMAGE_DJANGO}"
  compose ps
  exit 1
fi
echo "build na :${PORT} zgodny z wdrażanym obrazem"

echo "== prune unused images =="
docker image prune -af || true

compose ps
echo "OK"
