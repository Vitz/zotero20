#!/usr/bin/env bash
# Sprawdza, że PUBLICZNA domena serwuje dokładnie ten build, który właśnie wdrożyliśmy.
#
# Zielony deploy + świeży kontener na hoście NIE oznaczają, że domena wskazuje na ten host.
# Bez tej kontroli stary backend (inny serwer / tunel / rekord DNS) po cichu serwuje stary kod.
#
#   EXPECTED_BUILD   fragment, który musi wystąpić w polu "build" (zwykle GITHUB_SHA)
#   PUBLIC_BASE_URL  domyślnie https://zotero.keyweb.pl
#   ZOTERO20_API_KEY opcjonalnie — włącza kontrolę endpointów wymagających klucza
set -euo pipefail

BASE="${PUBLIC_BASE_URL:-https://zotero.keyweb.pl}"
EXPECTED="${EXPECTED_BUILD:-}"
API_KEY="${ZOTERO20_API_KEY:-}"
ATTEMPTS="${PUBLIC_VERIFY_ATTEMPTS:-10}"
DELAY="${PUBLIC_VERIFY_DELAY:-10}"

if [ -z "$EXPECTED" ]; then
  echo "BŁĄD: ustaw EXPECTED_BUILD (np. GITHUB_SHA)"
  exit 2
fi

build_of() {
  printf '%s' "$1" | sed -n 's/.*"build": *"\([^"]*\)".*/\1/p'
}

BODY=""
BUILD=""
for attempt in $(seq 1 "$ATTEMPTS"); do
  BODY=$(curl -sS --max-time 30 "${BASE}/api/v1/health" 2>&1 || true)
  BUILD=$(build_of "$BODY")
  if [ -n "$BUILD" ] && [ "${BUILD#*"$EXPECTED"}" != "$BUILD" ]; then
    break
  fi
  echo "public health: próba ${attempt}/${ATTEMPTS} — build=\"${BUILD:-<brak>}\", czekam ${DELAY}s…"
  BUILD=""
  [ "$attempt" -lt "$ATTEMPTS" ] && sleep "$DELAY"
done

if [ -z "$BUILD" ]; then
  ORIGIN=$(curl -sS -o /dev/null -D - --max-time 30 "${BASE}/api/v1/health" 2>/dev/null \
    | tr -d '\r' | sed -n 's/^[Xx]-[Zz]otero20-[Oo]rigin: *//p')
  cat >&2 <<EOF

==========================================================================
BŁĄD: ${BASE} NIE serwuje wdrożonego builda.

  oczekiwano build zawierającego : ${EXPECTED}
  odpowiedź /api/v1/health       : ${BODY}
  nagłówek X-Zotero20-Origin     : ${ORIGIN:-<brak — odpowiada host bez naszego vhosta Caddy>}

Kontenery i Caddy na hoście wdrożeniowym są aktualne (deploy sprawdza to lokalnie,
także przez własny listener Caddy), więc pod domeną odpowiada INNY backend —
rekord DNS originu wskazuje na inną maszynę niż DEPLOY_HOST.

Adresu originu nie widać w publicznym DNS, bo rekord jest za proxy Cloudflare.
Co zrobić:
  1. Weź adres z bloku "== origin dla Cloudflare ==" wypisanego przez ten deploy
     (krok "Deploy stack", na końcu setup-caddy.sh).
  2. Cloudflare → DNS → rekord tej nazwy. Jeśli AAAA/A różni się od tego adresu,
     ruch idzie na inną maszynę (np. poprzednią instancję VPS po migracji na inny
     węzeł — numer VPS zostaje ten sam, zmienia się prefiks IPv6). Popraw rekord.
  3. Wyłącz stary backend, żeby nie mógł ponownie przejąć domeny.
  4. Alternatywa bez rekordu na origin: Cloudflare Tunnel z hosta wdrożeniowego —
     ustaw sekret CLOUDFLARED_TUNNEL_TOKEN (deploy włączy profil "cloudflared")
     i skieruj hostname na ten tunel z ingress http://127.0.0.1:8089.
==========================================================================
EOF
  exit 1
fi

echo "public build OK: ${BUILD}"

if [ -z "$API_KEY" ]; then
  echo "Pominięto kontrolę endpointów z kluczem (brak ZOTERO20_API_KEY)"
  exit 0
fi

# 405 = endpoint istnieje (widok odrzuca GET), 404 = publiczny backend nie zna tej trasy.
for endpoint in citations bibliography styles; do
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
    -H "X-API-Key: ${API_KEY}" "${BASE}/api/v1/${endpoint}" || true)
  case "$CODE" in
    404|000)
      echo "BŁĄD: ${BASE}/api/v1/${endpoint} → HTTP ${CODE} (endpoint nieosiągalny publicznie)"
      exit 1
      ;;
    *)
      echo "public /api/v1/${endpoint} → HTTP ${CODE} OK"
      ;;
  esac
done
