#!/usr/bin/env bash
# Dodaje vhost zotero.keyweb.pl do Caddy docx2pdf (Mikrus).
set -euo pipefail

CADDY_DIR="${CADDY_DIR:-/opt/docx2pdf}"
CADDY_FILE="${CADDY_DIR}/Caddyfile.mikrus"
MARKER="zotero.keyweb.pl {"

if [ ! -f "${CADDY_FILE}" ]; then
  echo "Brak ${CADDY_FILE} — pomijam Caddy"
  exit 0
fi

if grep -q "${MARKER}" "${CADDY_FILE}"; then
  echo "Caddy: zotero.keyweb.pl już skonfigurowany"
else
  echo "Caddy: dodaję zotero.keyweb.pl"
  docker run --rm -v "${CADDY_DIR}:/mnt" alpine:3.20 sh -c "
    cat >> /mnt/Caddyfile.mikrus <<'EOF'

zotero.keyweb.pl {
	tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin-key.pem
	encode zstd gzip
	header {
		Strict-Transport-Security \"max-age=31536000; includeSubDomains\"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		X-Frame-Options DENY
		-Server
	}
	reverse_proxy 172.17.0.1:8089 {
		transport http {
			read_timeout 3m
			write_timeout 3m
			response_header_timeout 3m
		}
	}
}
EOF
  "
fi

if docker ps --format '{{.Names}}' | grep -q '^docx2pdf-caddy-1$'; then
  docker exec docx2pdf-caddy-1 caddy reload --config /etc/caddy/Caddyfile
  echo "Caddy: reload OK"
else
  echo "Caddy: kontener docx2pdf-caddy-1 nie działa"
fi

# Patch istniejącego vhosta: dodaj timeouty reverse_proxy (import DOI / Crossref)
if grep -q "${MARKER}" "${CADDY_FILE}" && ! grep -q 'read_timeout' "${CADDY_FILE}"; then
  echo "Caddy: dodaję timeouty reverse_proxy dla zotero.keyweb.pl"
  docker run --rm -v "${CADDY_DIR}:/mnt" alpine:3.20 sh -c "
    sed -i 's|reverse_proxy 172.17.0.1:8089|reverse_proxy 172.17.0.1:8089 {\\
\t\ttransport http {\\
\t\t\tread_timeout 3m\\
\t\t\twrite_timeout 3m\\
\t\t\tresponse_header_timeout 3m\\
\t\t}\\
\t}|' /mnt/Caddyfile.mikrus
  "
  if docker ps --format '{{.Names}}' | grep -q '^docx2pdf-caddy-1$'; then
    docker exec docx2pdf-caddy-1 caddy reload --config /etc/caddy/Caddyfile
    echo "Caddy: reload po patchu timeoutów OK"
  fi
fi
