# Patche na zotero-connectors

Pliki `.patch` nakładane przez `setup.sh` na sklonowane repo upstream (`connector/upstream/`).

## 001-remote-url-default.patch

- Domyślny `connector.url` → `https://zotero.keyweb.pl/`
- Pref `zotero20.apiKey` (pusty domyślnie; ustaw w Config Editor)
- Branding: „Zotero20 Connector” w `manifest.json` i `manifest-v3.json`

## 002-api-key-header.patch

- Nagłówek `X-API-Key` na wszystkich requestach Connector → Zotero Desktop (`connector.js`)
- Wartość z pref `zotero20.apiKey`

## 003-sidebar-postmessage.patch

- Nasłuch `postMessage` z panelu **Zotero20 Import** (Apps Script sidebar)
- Po imporcie DOI przycisk „Wstaw cytowanie” wywołuje `addEditCitation`
- Protokół: `source: zotero20-sidebar`, `action: addEditCitation`

Szczegóły protokołu: `003-sidebar-postmessage.patch.md`

## Usunięte

Patche **CF Access** (`CF-Access-Client-Id` / `Secret`) nie są używane — autoryzacja wyłącznie przez `X-API-Key` na bramce Django/Cloudflare.
