# zotero20-stack

Docker Compose na VPS (Mikrus) — **obok** innych usług (np. docx2pdf na `:8000`).

## Porty

| Usługa | Port localhost | Hostname CF |
|--------|----------------|-------------|
| docx2pdf (inny projekt) | 8000 | `docx2pdf-api.keyweb.pl` |
| **zotero20** | **8089** | `zotero.keyweb.pl` |

Instrukcja Mikrus: [../docs/deploy-mikrus.md](../docs/deploy-mikrus.md) (w repo zotero20).

## Szybki start

```bash
ssh -p 10283 deploy@wanda283.mikrus.xyz
mkdir -p ~/zotero20-stack && cd ~/zotero20-stack
git clone https://github.com/Vitz/zotero20-stack.git .
cp .env.example .env && cp config/studies.yaml.example config/studies.yaml
chmod +x scripts/*.sh && ./scripts/preflight.sh && ./scripts/deploy.sh
```

Obrazy: `ghcr.io/Vitz/zotero20-zotero` + `zotero20-django` (amd64, budowane z repo zotero20).

## Testy lokalne (Windows / Linux)

### Szybki start (Windows + Docker)

```powershell
# 1. Skopiuj konfigurację (jeśli brak stack/.env)
cp stack/.env.example stack/.env
# Uzupełnij ZOTERO20_API_KEY w stack/.env

# 2. Uruchom wszystkie testy (unit + Docker + integracja)
.\stack\scripts\run-local-tests.ps1 -Rebuild
```

Domyślnie skrypt buduje stack z `server/docker-compose.yml` (port **8000**).  
Aby użyć obrazów GHCR z `stack/docker-compose.yml` (port **8089**):

```powershell
.\stack\scripts\run-local-tests.ps1 -StackOnly -Rebuild
```

### Tylko testy jednostkowe (bez Dockera)

```powershell
.\stack\scripts\run-local-tests.ps1 -UnitOnly
```

lub w `server/django`:

```bash
pip install -r requirements-dev.txt
pytest tests/ -m "not integration" -q
```

### Smoke test na działającym stacku (bash)

```bash
cd stack
export ZOTERO20_API_KEY=...
export ZOTERO20_HOST_PORT=8089   # lub 8000 dla server/docker-compose
./scripts/integration-test.sh
# lub krótszy:
./scripts/test-api.sh
```

Pełna integracja wymaga `ZOTERO20_INTEGRATION=1` dla pytest:

```bash
cd server/django
ZOTERO20_INTEGRATION=1 ZOTERO20_API_KEY=... ZOTERO_BASE=http://127.0.0.1:8000 \
  pytest tests/test_integration_stack.py -m integration -q
```

## Izolacja

- Projekt: `docker compose -p zotero20`
- Nie rusza innych kontenerów na hoście
- Brak `build` na serwerze — tylko `pull`

## Routing publiczny — dlaczego domena potrafi serwować stary kod

Ścieżka żądania: `zotero.keyweb.pl` → Cloudflare → **origin (rekord AAAA)** → Caddy
(`docx2pdf-caddy-1`) → `172.17.0.1:8089` → `zotero20-zotero` → Django.

Origin jest wskazywany rekordem **AAAA**, bo `:443` na współdzielonym IPv4 Mikrusa
obsługuje nginx dostawcy — rekord A tam nie trafia do naszego Caddy. Adres originu nie
jest widoczny w publicznym DNS (rekord jest za proxy Cloudflare), więc `setup-caddy.sh`
wypisuje w logu deployu blok `== origin dla Cloudflare ==` z adresem IPv6 hosta —
to jedyne miejsce, gdzie można porównać go z rekordem w panelu.

Uwaga na migracje Mikrusa: po przeniesieniu VPS-a na inny węzeł numer instancji zostaje
ten sam, ale zmienia się prefiks IPv6 (np. `2a01:4f9:3100:4648::283` →
`2a01:4f9:3070:22d7::283`). Stary rekord dalej działa i serwuje poprzednią instancję,
więc deploy jest zielony, a domena zwraca stary kod. Dlatego:

- `/api/v1/health` zwraca pole `build` z tagiem obrazu,
- vhost Caddy dokłada nagłówek `X-Zotero20-Origin` z nazwą maszyny,
- `scripts/verify-public.sh` (krok „Verify public domain serves this build” w deployu)
  odpytuje **publiczny adres** i wywala deploy, gdy `build` nie zgadza się z wdrażanym SHA.

Kto naprawdę odpowiada pod domeną:

```bash
curl -sS -D - https://zotero.keyweb.pl/api/v1/health | grep -iE 'x-zotero20-origin|build'
```

Który adres realnie odpowiada (test z pominięciem Cloudflare):

```bash
curl -sSk -g --resolve zotero.keyweb.pl:443:[ADRES_IPV6] \
  https://zotero.keyweb.pl/api/v1/health
```

Obsługiwane sposoby wpięcia hosta wdrożeniowego jako originu:

1. **Rekord AAAA (proxied) na IPv6 hosta** — obecna konfiguracja. Adres bierz z bloku
   `== origin dla Cloudflare ==` w logu deployu, nie z pamięci.
2. **Cloudflare Tunnel z tego hosta** — ustaw sekret `CLOUDFLARED_TUNNEL_TOKEN`
   (deploy włączy wtedy profil `cloudflared` z `docker-compose.yml`),
   a w Cloudflare skieruj hostname na ten tunel z ingress `http://127.0.0.1:8089`.
   Odporne na zmianę adresu VPS-a.

Stary origin trzeba wyłączyć — inaczej przy każdej zmianie DNS może wrócić.
