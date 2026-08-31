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

## Izolacja

- Projekt: `docker compose -p zotero20`
- Nie rusza innych kontenerów na hoście
- Brak `build` na serwerze — tylko `pull`
