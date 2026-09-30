# Deploy na RPi5 — zotero.keyweb.pl (jeden host)

## Architektura

Wszystko idzie przez **Django na :8000**:

| Ścieżka | Cel |
|---------|-----|
| `/connector/*` | proxy → Zotero (cytowania) |
| `/api/users/*`, `/api/plus/*` | proxy → Zotero Local API |
| `/api/v1/*` | Django import ORCID/DOI |
| `/app/` | panel admin (captcha + honeypot) |

Zotero **nie jest** wystawiony na tunel — tylko Django.

## Wymagane zmienne (.env)

```bash
ZOTERO20_API_KEY=...        # Connector + Google Docs sidebar
DJANGO_SECRET_KEY=...
CAPTCHA_TYPE=simple         # none | simple | recaptcha | hcaptcha
```

## Deploy

```bash
./scripts/preflight-rpi.sh   # pierwszy raz — sprawdź konflikty portów
./scripts/setup-rpi.sh
```

Szczegóły izolacji od innych kontenerów Docker: **[rpi-docker-isolation.md](rpi-docker-isolation.md)**.

Tunel CF (`config.yml.example`):

```yaml
- hostname: zotero.keyweb.pl
  service: http://127.0.0.1:8089
```

Port **8089** na RPi (jak `jf`→8096, `fb`→8088). Stack compose: `stack/` → osobne repo **[zotero20-stack](stack/README.md)**.

## Admin

```bash
docker compose -f docker-compose.prod.yml exec django \
  python manage.py createsuperuser
```

Logowanie: `https://zotero.keyweb.pl/app/`

## Test (lokalnie na RPi)

```bash
export ZOTERO20_API_KEY=twoj-klucz
export ZOTERO_BASE=http://127.0.0.1:8000
./scripts/test-zotero-api.sh
```

Przez tunel:

```bash
export ZOTERO_BASE=https://zotero.keyweb.pl
export ZOTERO20_API_KEY=twoj-klucz
./scripts/test-zotero-api.sh
```

## Kolejność

1. Docker + smoke test z API key
2. Tunel na `zotero.keyweb.pl` → `:8000`
3. Fork Connector z `connector.url` + `zotero20.apiKey`
4. Sidebar GAS z `ZOTERO20_API_KEY` w Script Properties
