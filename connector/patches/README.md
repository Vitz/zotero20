# Patche na zotero-connectors

Pliki `.patch` nakładane przez `setup.sh` na sklonowane repo upstream.

## 001-remote-url-default.patch

- Domyślny `connector.url` → `https://zotero.keyweb.pl`
- Branding: „Zotero20 Connector”

## 002-cf-access-headers.patch

- Do requestów HTTP do Zotero dodaje nagłówki:
  - `CF-Access-Client-Id`
  - `CF-Access-Client-Secret`
- Wartości z `chrome.storage.local` (Options page) lub build-time `config.json`

Logika Google Docs **nie jest zmieniana** — tylko transport HTTP.
