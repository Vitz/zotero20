# Deploy na Mikrus (obok docx2pdf)

Ten sam VPS, **drugi** `docker compose` — **nie** drugie konto Mikrus (chyba że chcesz płacić 2×).

## Czy zadziała osobny compose?

**Tak.** Tak samo jak masz `docx2pdf` — zotero20 to izolowany projekt:

| | docx2pdf | zotero20 |
|--|----------|----------|
| Projekt compose | własny (np. `docx2pdf`) | `zotero20` (`-p zotero20`) |
| Katalog | np. `~/docx2pdf` | `~/zotero20-stack` |
| Port localhost | **8000** | **8089** (inny!) |
| Hostname CF | `docx2pdf-api.keyweb.pl` | `zotero.keyweb.pl` |
| Kontenery | własne nazwy | `zotero20-*` |
| Wolumeny | własne | `zotero20-*` |

Deploy **nie uruchamia** `docker compose down` globalnie, nie robi `prune`, nie dotyka cudzych kontenerów.

---

## Porty na Mikrusie

```
127.0.0.1:8000  → docx2pdf (już działa)
127.0.0.1:8089  → zotero20 Django gateway (nowy)
```

W Cloudflare Tunnel zmień route `zotero.keyweb.pl`:

```
http://<IP_MIKRUSA>:8089
```

(lub `127.0.0.1:8089` jeśli cloudflared działa **na tym samym** Mikrusie co Docker)

**Nie** używaj portu 8000 dla zotero — kolidowałby z docx2pdf.

---

## RAM — sprawdź przed startem

Zotero Desktop w Dockerze to **~1–1,5 GB RAM** + Django + docx2pdf/Gotenberg.

```bash
ssh -p 10283 deploy@wanda283.mikrus.xyz
free -h
docker stats --no-stream
```

Jeśli masz ≤2 GB RAM i docx2pdf już chodzi — może być ciasno. Rozważ:
- większy plan Mikrus, albo
- zotero na RPi, docx2pdf na Mikrusie (hybryda)

---

## Setup (ten sam user `deploy`)

```bash
ssh -p 10283 deploy@wanda283.mikrus.xyz

mkdir -p ~/zotero20-stack
cd ~/zotero20-stack
git clone https://github.com/Vitz/zotero20-stack.git .
cp .env.example .env
cp config/studies.yaml.example config/studies.yaml
nano .env   # klucze, obrazy GHCR, ZOTERO20_HOST_PORT=8089
chmod +x scripts/*.sh
./scripts/preflight.sh
./scripts/deploy.sh
docker compose -p zotero20 exec django python manage.py createsuperuser
```

### `.env` (ważne)

```bash
ZOTERO20_HOST_PORT=8089
DJANGO_ALLOWED_HOSTS=zotero.keyweb.pl,localhost,127.0.0.1
ZOTERO20_API_KEY=...          # inny niż docx2pdf FREE_ADMIN_KEY
ZOTERO20_IMAGE_ZOTERO=ghcr.io/Vitz/zotero20-zotero:latest
ZOTERO20_IMAGE_DJANGO=ghcr.io/Vitz/zotero20-django:latest
```

Obrazy **amd64** — budowane w GitHub Actions (Mikrus to x86, nie ARM).

---

## GitHub Actions (deploy)

Variables (repo `zotero20` lub `zotero20-stack`):

| Variable | Wartość |
|----------|---------|
| `DEPLOY_HOST` | `wanda283.mikrus.xyz` |
| `DEPLOY_SSH_PORT` | `10283` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_PATH` | `/home/deploy/zotero20-stack` |

Secrets: `DEPLOY_SSH_KEY`, `ZOTERO20_API_KEY`

**Nie** myl z docx2pdf deploy — osobny `DEPLOY_PATH`, osobny workflow w stack repo.

---

## Konfiguracja badań (`studies.yaml`)

Panel importu w Google Docs i endpoint `POST /api/v1/import/doi` wymagają pola **`study`** — slug z tego pliku. Bez prawdziwych `collection_key` lista badań w sidebarze będzie pusta lub niewybieralna.

### 1. Edytuj plik na Mikrusie

```bash
ssh -p 10283 deploy@wanda283.mikrus.xyz
cd ~/zotero20-stack
nano config/studies.yaml
```

Przykład (dostosuj nazwy i klucze):

```yaml
studies:
  badanie-1:
    label: "Badanie 1"
    collection_key: "ABC12XYZ"
  badanie-2:
    label: "Badanie 2"
    collection_key: "DEF34UVW"
```

- **`slug`** (`badanie-1`) — identyfikator w API i sidebarze; tylko małe litery, cyfry, myślniki.
- **`label`** — czytelna nazwa w dropdownie.
- **`collection_key`** — 8-znakowy klucz kolekcji Zotero (nie nazwa folderu).

### 2. Pobierz `collection_key` z Zotero

Po starcie kontenerów Zotero:

```bash
cd ~/zotero20-stack
docker compose -p zotero20 exec zotero \
  curl -s http://127.0.0.1:23119/api/users/0/collections
```

W odpowiedzi JSON szukaj `"key"` przy `"name"` kolekcji. Wklej ten klucz do `collection_key`.

### 3. Sprawdź endpoint

```bash
source .env
curl -sS -H "X-API-Key: $ZOTERO20_API_KEY" http://127.0.0.1:8089/api/v1/studies
```

Oczekiwane: `"studies": [...]` z co najmniej jednym wpisem `"configured": true`.

Plik jest montowany do kontenera Django (`read-only`) — **restart nie jest wymagany**, zmiany działają od razu.

### 4. Google Docs sidebar

W Apps Script (Script Properties) musi być ten sam **`ZOTERO20_API_KEY`** co w `.env` na serwerze. Po zmianie `studies.yaml` zamknij i otwórz panel importu ponownie.

Typowy błąd **`Wymagane pola: doi, study.`** = pusta lista badań (brak/niepoprawny `studies.yaml` lub zły klucz API przy ładowaniu `/api/v1/studies`).

---

## Test po deploy

```bash
# na Mikrusie
curl -fsS http://127.0.0.1:8089/api/v1/health
export ZOTERO20_API_KEY=...
./scripts/test-api.sh

# przez tunel
curl -fsS https://zotero.keyweb.pl/api/v1/health
```

---

## Druga konto Mikrus — kiedy?

| Osobny compose (zalecane) | Drugie konto Mikrus |
|---------------------------|---------------------|
| Ten sam VPS, 0 zł więcej | Osobna opłata |
| Izolacja wystarczająca przy `-p zotero20` | Pełna izolacja OS |
| Wspólny limit RAM CPU | Osobne limity |

**Wniosek:** zacznij od **drugiego compose w `~/zotero20-stack`** na tym samym `deploy`. Drugie konto tylko jeśli brakuje RAM.

---

## Checklist „nie zepsuć docx2pdf”

- [ ] Port **8089**, nie 8000
- [ ] `docker compose -p zotero20` (zawsze z `-p`)
- [ ] Nie uruchamiaj `docker compose down` bez `-p` w katalogu docx2pdf
- [ ] `./scripts/preflight.sh` — sprawdź czy 8089 wolny
- [ ] Osobny `.env` — nie mieszaj kluczy z docx2pdf
- [ ] Po deploy: `curl docx2pdf-api.keyweb.pl/healthz` — nadal OK
