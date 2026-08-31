#!/usr/bin/env bash
# Dodaje vhost zotero.keyweb.pl do Caddy docx2pdf (Mikrus).
set -euo pipefail

CADDY_FILE="${CADDY_FILE:-/opt/docx2pdf/Caddyfile.mikrus}"
MARKER="zotero.keyweb.pl {"
BLOCK='zotero.keyweb.pl {
	tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin-key.pem
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		X-Frame-Options DENY
		-Server
	}
	reverse_proxy 172.17.0.1:8089
}'

if [ ! -f "${CADDY_FILE}" ]; then
  echo "Brak ${CADDY_FILE} — pomijam Caddy"
  exit 0
fi

if grep -q "${MARKER}" "${CADDY_FILE}"; then
  echo "Caddy: zotero.keyweb.pl już skonfigurowany"
else
  echo "Caddy: dodaję zotero.keyweb.pl"
  printf '\n%s\n' "${BLOCK}" | sudo tee -a "${CADDY_FILE}" >/dev/null
fi

if docker ps --format '{{.Names}}' | grep -q '^docx2pdf-caddy-1$'; then
  docker exec docx2pdf-caddy-1 caddy reload --config /etc/caddy/Caddyfile
  echo "Caddy: reload OK"
else
  echo "Caddy: kontener docx2pdf-caddy-1 nie działa"
fi
