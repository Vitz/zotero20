# GitHub Actions — auto deploy (checklist)

Cel: push na `main` → testy → deploy na RPi5 (`zotero.keyweb.pl`).

---

## 1. Jednorazowo na RPi5 (przed CI/CD)

- [ ] Użytkownik deploy, np. `deploy`, w grupie `docker`
- [ ] Katalog aplikacji, np. `/opt/zotero20`
- [ ] Sklonowane repo (pierwszy raz ręcznie lub przez Actions)
- [ ] Plik `server/.env` **tylko na serwerze** (nigdy w git):
  - `DJANGO_SECRET_KEY`
  - `ZOTERO20_API_KEY`
  - `CAPTCHA_TYPE` + klucze captcha
  - `DJANGO_ALLOWED_HOSTS=zotero.keyweb.pl`
- [ ] `server/django/config/studies.yaml` z prawdziwymi `collection_key`
- [ ] `server/cloudflared/config.yml` + `*.json` credentials tunelu
- [ ] `docker compose -f docker-compose.prod.yml up -d` działa ręcznie
- [ ] `createsuperuser` wykonany
- [ ] Klucz SSH **tylko do deploy** (ed25519), dodany do `~deploy/.ssh/authorized_keys`

**Wolumeny Docker (nie ruszać przy deploy):**
- `zotero-profile` — biblioteka Zotero
- `django-data` — SQLite admin

---

## 2. Sekrety w GitHub (Settings → Secrets and variables → Actions)

| Secret | Po co |
|--------|--------|
| `DEPLOY_HOST` | `172.16.2.10:8089` — **bez** `http://` (workflow sam parsuje port) |
| `DEPLOY_USER` | np. `deploy` |
| `DEPLOY_SSH_KEY` | prywatny klucz SSH (cały plik, bez hasła) |
| `DEPLOY_PATH` | np. `/opt/zotero20` |
| `ZOTERO20_API_KEY` | opcjonalnie do smoke testu po deploy (nie zastępuje `.env` na serwerze) |

**Nie trzymaj w GitHub Secrets:** `DJANGO_SECRET_KEY` produkcyjny, credentials cloudflared — zostają tylko na RPi.

Opcjonalnie **Variables** (nie tajne):
- `DEPLOY_COMPOSE_FILE` = `docker-compose.prod.yml`

---

## 3. Workflowy do utworzenia w `.github/workflows/`

### A. `ci.yml` — każdy PR i push

- [ ] Trigger: `pull_request`, `push` (branch `main` + feature)
- [ ] Job `django-check`:
  - `python -m pip install -r server/django/requirements.txt`
  - `cd server/django && python manage.py check`
  - (opcjonalnie) `python -m compileall apps/`
- [ ] Job `docker-build` (walidacja Dockerfile):
  - `docker/build-push-action` z `push: false`
  - platforma: `linux/arm64` (jak RPi5) — wymaga QEMU/buildx na runnerze
- [ ] Cache pip + Docker layers

### B. `deploy.yml` — tylko `main` (lub tag `v*`)

- [ ] Trigger: `push` → `main` (opcjonalnie `workflow_dispatch` — ręczny deploy)
- [ ] `needs: ci` lub wbudowane testy przed deploy
- [ ] Job `deploy` przez **SSH** (najprostsze na RPi):

```yaml
# szkic kroków (nie pełny plik)
- ssh deploy@rpi "cd /opt/zotero20 && git fetch && git reset --hard origin/main"
- ssh deploy@rpi "cd /opt/zotero20/server && docker compose -f docker-compose.prod.yml build"
- ssh deploy@rpi "cd /opt/zotero20/server && docker compose -f docker-compose.prod.yml up -d"
- ssh deploy@rpi "cd /opt/zotero20/server && docker compose -f docker-compose.prod.yml exec -T django python manage.py migrate --noinput"
- smoke test z ZOTERO20_API_KEY
```

- [ ] Rollback: trzymaj poprzedni tag obrazu lub `git reset --hard HEAD~1` + `compose up`

### C. (Opcjonalnie) `connector-build.yml`

- [ ] Build fork Connectora → artefakt `.zip` do ręcznej instalacji w Chrome
- [ ] **Nie** deploy na RPi — wtyczka u użytkowników

### D. (Opcjonalnie) self-hosted runner na RPi

Zamiast SSH + build na RPi z GitHuba:
- [ ] Zainstaluj `actions-runner` na RPi
- [ ] Label: `rpi5`
- [ ] `runs-on: [self-hosted, rpi5]` — build natywnie arm64, szybciej

---

## 4. Skrypt deploy na serwerze (zalecane)

Utwórz `scripts/deploy.sh` wywoływany z Actions:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../server"
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker compose -f docker-compose.prod.yml exec -T django python manage.py migrate --noinput
# health
curl -fsS http://127.0.0.1:8000/api/v1/health
```

- [ ] Skrypt idempotentny (wielokrotne uruchomienie OK)
- [ ] **Nie** nadpisuje `.env`, `studies.yaml`, `cloudflared/*.json`
- [ ] **Nie** robi `docker compose down -v` (kasowałoby bibliotekę!)

---

## 5. `.gitignore` — upewnij się że wykluczone

- [ ] `server/.env`
- [ ] `server/django/config/studies.yaml`
- [ ] `server/cloudflared/*.json`
- [ ] `server/cloudflared/config.yml` (jeśli z credentials)

---

## 6. Smoke test po deploy (w Actions)

```bash
export ZOTERO_BASE=https://zotero.keyweb.pl   # lub http://127.0.0.1:8000 przez SSH
export ZOTERO20_API_KEY=${{ secrets.ZOTERO20_API_KEY }}
./scripts/test-zotero-api.sh
```

- [ ] Fail workflow jeśli ping / health != OK
- [ ] Powiadomienie (opcjonalnie): Slack / email przy failure

---

## 7. Branch protection (GitHub repo settings)

- [ ] `main`: wymagany passing CI przed merge
- [ ] (opcjonalnie) wymagany review PR

---

## 8. Czego **nie** automatyzować w pierwszej iteracji

| Element | Dlaczego ręcznie |
|---------|------------------|
| `server/.env` | sekrety produkcyjne |
| `studies.yaml` / collection keys | dane Zotero specyficzne dla instancji |
| cloudflared credentials | jednorazowa konfiguracja CF |
| `createsuperuser` | jednorazowo |
| Google Apps Script (`clasp push`) | osobne konto Google, OAuth |
| Zotero Connector w Chrome | instalacja u każdego użytkownika |

---

## 9. Kolejność implementacji (rekomendowana)

1. [ ] `ci.yml` — check + docker build (bez deploy)
2. [ ] `scripts/deploy.sh` na RPi + test ręczny
3. [ ] `deploy.yml` SSH na `main`
4. [ ] Smoke test w deploy
5. [ ] (później) self-hosted runner jeśli build arm64 na GitHub jest wolny
6. [ ] (później) artefakt Connectora

---

## 10. Minimalny szkielet `deploy.yml`

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            set -e
            cd ${{ secrets.DEPLOY_PATH }}
            git fetch origin main
            git reset --hard origin/main
            chmod +x scripts/*.sh
            ./scripts/deploy.sh

      - name: Smoke test
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            export ZOTERO_BASE=http://127.0.0.1:8000
            export ZOTERO20_API_KEY=${{ secrets.ZOTERO20_API_KEY }}
            cd ${{ secrets.DEPLOY_PATH }}
            ./scripts/test-zotero-api.sh
```

---

## Uwagi RPi / arm64

- GitHub `ubuntu-latest` buduje **amd64** — na RPi albo:
  - **build na RPi** (SSH / self-hosted runner) — **zalecane**, lub
  - `docker buildx build --platform linux/arm64` + push do GHCR + pull na RPi
- Pierwszy deploy Zotero trwa ~3–5 min (pobieranie Zotero 10) — ustaw timeout joba ≥ 15 min
