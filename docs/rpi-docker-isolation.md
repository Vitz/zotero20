# RPi z wieloma usługami Docker — bezpieczny deploy zotero20

## Zasada: nie dotykamy innych stacków

Deploy robi **wyłącznie**:

```bash
docker compose -p zotero20 -f docker-compose.prod.yml pull
docker compose -p zotero20 -f docker-compose.prod.yml up -d --no-build
```

| Co | Izolacja |
|----|----------|
| Nazwa projektu | `zotero20` (`-p zotero20`) |
| Kontenery | `zotero20-zotero`, `zotero20-django`, opcjonalnie `zotero20-cloudflared` |
| Wolumeny | `zotero20-zotero-profile`, `zotero20-django-data` |
| Port na hoście | tylko `127.0.0.1:8000` |
| Build na RPi | **NIE** — obrazy z GHCR |

**Nigdy** w skryptach: `docker system prune`, `docker compose down` bez `-p zotero20`, `down -v`.

---

## Obrazy na osobnym GitHub (GHCR)

Build odbywa się w **GitHub Actions** (arm64), push do:

```
ghcr.io/<OWNER>/zotero20-zotero:<sha>
ghcr.io/<OWNER>/zotero20-django:<sha>
```

### Opcja A — ten sam repo (`Vitz/zotero20`)

Variables (opcjonalne):

| Variable | Przykład |
|----------|----------|
| `GHCR_OWNER` | `Vitz` |
| `GHCR_IMAGE_PREFIX` | `zotero20` |

Obrazy: `ghcr.io/Vitz/zotero20-django:latest`

### Opcja B — osobne repo tylko na paczki (zalecane przy wielu usługach)

1. Utwórz repo np. `Vitz/zotero20-images` (puste / README)
2. W **zotero20** → Settings → Actions → General → Workflow permissions: **Read and write**
3. Utwórz PAT (classic) z `read:packages`, `write:packages` na koncie z dostępem do obu repo
4. W **zotero20** Secrets: `GHCR_PUSH_TOKEN` (do publish — jeśli potrzebny cross-repo)
5. Variables: `GHCR_OWNER=Vitz`, `GHCR_IMAGE_PREFIX=zotero20-images`

Na RPi w `.env` (jeśli prywatne):

```bash
GHCR_PULL_TOKEN=ghp_...
GHCR_PULL_USER=Vitz
```

Publiczne obrazy GHCR — pull bez logowania.

---

## Jeśli masz już cloudflared

Inne usługi mogą już używać tunelu. **Nie uruchamiaj drugiego** bez potrzeby.

W `server/.env`:

```bash
ZOTERO20_ENABLE_CLOUDFLARED=0
```

Dodaj route w **istniejącym** configu tunelu:

```yaml
- hostname: zotero.keyweb.pl
  service: http://127.0.0.1:8000
```

---

## Przed pierwszym deploy

Na RPi:

```bash
chmod +x scripts/preflight-rpi.sh
./scripts/preflight-rpi.sh
```

Sprawdź czy `127.0.0.1:8000` jest wolny. Jeśli zajęty — zmień mapowanie portu w `docker-compose.prod.yml` i route w cloudflared.

---

## Pliki tylko na RPi (nie z git)

- `server/.env` — sekrety + `ZOTERO20_IMAGE_*`
- `server/django/config/studies.yaml`
- `server/cloudflared/` — jeśli używasz profilu cloudflared

---

## Flow deploy

```
push main → CI → build arm64 → GHCR → SSH na RPi → pull → up --no-build → migrate → smoke test
```

Inne kontenery na RPi pozostają nietknięte.
