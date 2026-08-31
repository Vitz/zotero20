# Zotero20 Connector (fork)

Jeden host: `https://zotero.keyweb.pl` + nagłówek **X-API-Key**.

## Stan repozytorium (scaffold, nie pełny build)

| Element | Status |
|---------|--------|
| `setup.sh` — klon upstream + patch X-API-Key | ✅ gotowy |
| Zmiana nazwy w `manifest.json` | ✅ w `setup.sh` |
| `patches/README.md` — opis patchy CF Access / URL | 📋 dokumentacja (pliki `.patch` jeszcze nie w repo) |
| Katalog `upstream/` po klonie | ❌ nie commitowany — powstaje lokalnie po `./setup.sh` |
| Gotowy build / `dist/` | ❌ trzeba zbudować lokalnie |
| Nasłuch `postMessage` z sidebara importu | ❌ planowany patch (Faza 2) |

**Wniosek:** fork jest **szkieletem** — zmienia transport HTTP (URL + API key), ale **nie zawiera** gotowej wtyczki ani rozszerzonej integracji Docs. Logika cytowań pochodzi w całości z upstream `zotero-connectors` (content script Google Docs).

## Co daje fork po zbudowaniu

Po `npm run build` i załadowaniu w Chrome/Firefox:

- Menu **Zotero** w Google Docs (jak oficjalny Connector)
- **Add/Edit Citation** — wstawia field codes w miejscu kursora (citeproc na serwerze)
- **Add/Edit Bibliography**
- **Document Preferences** — styl cytowań
- **Refresh** — odświeżenie cytowań i metadanych
- **Unlink Citations**

Wszystkie requesty cytowań: `POST /connector/document/execCommand` i `/respond` przez tunel do Zotero Desktop na RPi.

## Build

```bash
cd connector
./setup.sh
cd upstream && npm install && npm run build
```

Chrome → Load unpacked → folder buildu Chrome (np. `upstream/build/browserSpecific/chrome` — ścieżka zależy od wersji upstream).

## Konfiguracja wtyczki (Options / about:config)

| Pref | Wartość |
|------|---------|
| `connector.url` | `https://zotero.keyweb.pl` |
| `zotero20.apiKey` | ten sam co `ZOTERO20_API_KEY` w `.env` |

## Planowany patch: sidebar → Connector

Aby przycisk **„Wstaw cytowanie”** w panelu importu otwierał dialog cytowań bez ręcznego menu:

W content script Google Docs (upstream) dodać:

```javascript
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== 'zotero20-sidebar' || data.action !== 'addEditCitation') return;
  // itemKey / doi — opcjonalnie prefiltruj wybór w przyszłości
  Zotero.GoogleDocs.execCommand('addEditCitation');
});
```

`itemKey` z sidebara może w przyszłości ograniczyć wybór w dialogu — wymaga dodatkowej pracy w citing protocol (nie w Apps Script).

## Patche

Szczegóły w `patches/README.md`. Obecnie `setup.sh` nakłada tylko patch X-API-Key inline na `src/common/http.js`.
