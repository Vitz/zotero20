#!/usr/bin/env bash
# Zarządza vhostem zotero.keyweb.pl w Caddy docx2pdf (Mikrus).
#
# Blok vhosta jest generowany od zera przy każdym deployu i podmieniany w miejscu —
# doklejanie + łatanie sedem zostawiało konfigurację z poprzedniej wersji repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "${ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

CADDY_DIR="${CADDY_DIR:-/opt/docx2pdf}"
CADDY_FILE="${CADDY_DIR}/Caddyfile.mikrus"
CADDY_CONTAINER="${CADDY_CONTAINER:-docx2pdf-caddy-1}"
DOMAIN="${ZOTERO20_DOMAIN:-zotero.keyweb.pl}"
PORT="${ZOTERO20_HOST_PORT:-8089}"
UPSTREAM="${ZOTERO20_CADDY_UPSTREAM:-172.17.0.1}:${PORT}"
# Odcisk hosta w odpowiedzi — jedno curl wystarczy, by stwierdzić, która maszyna odpowiada.
ORIGIN_ID="${ZOTERO20_ORIGIN_ID:-$(hostname)}"

if [ ! -f "${CADDY_FILE}" ]; then
  echo "Brak ${CADDY_FILE} — pomijam Caddy"
  exit 0
fi

VHOST=$(cat <<EOF
${DOMAIN} {
	tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin-key.pem
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		X-Frame-Options DENY
		X-Zotero20-Origin "${ORIGIN_ID}"
		-Server
	}
	reverse_proxy ${UPSTREAM} {
		transport http {
			read_timeout 3m
			write_timeout 3m
			response_header_timeout 3m
		}
	}
}
EOF
)

DOMAIN_RE=$(printf '%s' "${DOMAIN}" | sed 's/\./\\./g')
WORK_DIR=$(mktemp -d)
trap 'rm -rf "${WORK_DIR}"' EXIT

# Wytnij poprzedni blok vhosta (licząc klamry), utnij puste linie z końca, dopisz nowy.
awk -v re="^${DOMAIN_RE}[[:space:]]*\\{" '
  skip == 1 {
    depth += gsub(/\{/, "{") - gsub(/\}/, "}")
    if (depth <= 0) { skip = 0 }
    next
  }
  $0 ~ re { skip = 1; depth = 1; next }
  { lines[++n] = $0 }
  END {
    while (n > 0 && lines[n] ~ /^[[:space:]]*$/) { n-- }
    for (i = 1; i <= n; i++) print lines[i]
  }
' "${CADDY_FILE}" > "${WORK_DIR}/base"

{ cat "${WORK_DIR}/base"; echo; printf '%s\n' "${VHOST}"; } > "${WORK_DIR}/new"

if cmp -s "${WORK_DIR}/new" "${CADDY_FILE}"; then
  RESULT=UNCHANGED
else
  RESULT=CHANGED
  # Zapis wymaga roota — user deployu ma tylko dostęp do dockera.
  docker run --rm -v "${CADDY_DIR}:/mnt" -v "${WORK_DIR}:/new:ro" alpine:3.20 sh -c \
    'cp /mnt/Caddyfile.mikrus /mnt/Caddyfile.mikrus.zotero20.bak && cp /new/new /mnt/Caddyfile.mikrus'
fi

echo "Caddy: vhost ${DOMAIN} → ${UPSTREAM} (${RESULT})"

if ! docker ps --format '{{.Names}}' | grep -q "^${CADDY_CONTAINER}$"; then
  echo "Caddy: kontener ${CADDY_CONTAINER} nie działa — pomijam reload"
  exit 0
fi

if [ "${RESULT}" = "CHANGED" ]; then
  if ! docker exec "${CADDY_CONTAINER}" caddy validate --config /etc/caddy/Caddyfile \
    || ! docker exec "${CADDY_CONTAINER}" caddy reload --config /etc/caddy/Caddyfile; then
    echo "BŁĄD: Caddy odrzucił konfigurację — przywracam kopię zapasową"
    docker run --rm -v "${CADDY_DIR}:/mnt" alpine:3.20 \
      sh -c 'cp /mnt/Caddyfile.mikrus.zotero20.bak /mnt/Caddyfile.mikrus'
    docker exec "${CADDY_CONTAINER}" caddy reload --config /etc/caddy/Caddyfile || true
    exit 1
  fi
  echo "Caddy: reload OK"
fi

# Kontrola przez sam listener Caddy (nie tylko upstream) — łapie zły vhost i zły upstream.
LOCAL=""
for attempt in 1 2 3; do
  LOCAL=$(curl -sSk --max-time 20 --connect-to "${DOMAIN}:443:127.0.0.1:443" \
    "https://${DOMAIN}/api/v1/health" 2>/dev/null || true)
  [ -n "${LOCAL}" ] && break
  sleep 3
done
echo "Caddy → ${DOMAIN} (lokalnie): ${LOCAL:-<brak odpowiedzi>}"
if [ -n "${ZOTERO20_IMAGE_DJANGO:-}" ] && [ "${LOCAL#*"${ZOTERO20_IMAGE_DJANGO}"}" = "${LOCAL}" ]; then
  echo "BŁĄD: Caddy na tym hoście nie serwuje wdrożonego builda (${ZOTERO20_IMAGE_DJANGO})"
  exit 1
fi
