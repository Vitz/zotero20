# Zotero20 Connector (fork)

Fork [zotero-connectors](https://github.com/zotero/zotero-connectors) — zdalne Zotero Desktop przez `https://zotero.keyweb.pl` + nagłówek **X-API-Key**.

**Instalacja krok po kroku:** [INSTALL.md](INSTALL.md)

## Szybki start

```bash
cd connector
./setup.sh
cd upstream && npm install && ./build.sh
```

Chrome → `chrome://extensions` → Load unpacked → `connector/upstream/build/manifestv3`

Config Editor:

| Pref | Wartość |
|------|---------|
| `connector.url` | `https://zotero.keyweb.pl/` |
| `zotero20.apiKey` | `ZOTERO20_API_KEY` z `server/.env` |

## Co daje fork

| Funkcja | Status |
|---------|--------|
| Menu **Zotero** w Google Docs | ✅ upstream + patche |
| Add/Edit Citation, Bibliography, Refresh | ✅ citing protocol → serwer |
| Domyślny URL tunelu | ✅ patch 001 |
| Nagłówek `X-API-Key` | ✅ patch 002 |
| Branding „Zotero20 Connector” | ✅ patch 001 |
| Most `postMessage` z sidebara importu | ✅ patch 003 |
| Build lokalny | `./build.sh` (wymaga bash) |
| Build CI (GitHub Actions) | `.github/workflows/build-connector.yml` |

## Patche

Katalog `patches/` — szczegóły w [patches/README.md](patches/README.md).

| Patch | Cel |
|-------|-----|
| `001-remote-url-default.patch` | URL + pref API key + nazwa wtyczki |
| `002-api-key-header.patch` | `X-API-Key` w `connector.js` |
| `003-sidebar-postmessage.patch` | sidebar → `addEditCitation` |

Katalog `upstream/` powstaje lokalnie po `setup.sh` — **nie commitowany** (`.gitignore`).

## Integracja z panelem importu

Panel Apps Script (`google-docs/sidebar/`) po imporcie DOI wysyła:

```json
{
  "source": "zotero20-sidebar",
  "action": "addEditCitation",
  "itemKey": "ABC123XY",
  "doi": "10.1038/...",
  "ts": 1710000000000
}
```

Connector (patch 003) wywołuje `Zotero.GoogleDocs.execCommand('addEditCitation')`.

Pełna dokumentacja: [docs/google-docs-setup.md](../docs/google-docs-setup.md)

## Architektura

```
Chrome (Zotero20 Connector)
  └── docs.google.com — menu Zotero, field codes
        └── HTTPS → zotero.keyweb.pl/connector/*
              └── Zotero Desktop (RPi) + citeproc

Google Docs sidebar (Apps Script)
  └── HTTPS → zotero.keyweb.pl/api/v1/import/*
        └── Django → Zotero Local API (kolekcje, DOI, ORCID)
```

Import (sidebar) i cytowania (Connector) są **różnymi ścieżkami** — oba korzystają z tej samej biblioteki na serwerze.
