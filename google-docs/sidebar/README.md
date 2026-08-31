# Panel importu ORCID/DOI (Zotero20 Import)

Base URL: `https://zotero.keyweb.pl/api/v1`

## Co robi ten sidebar (dziś)

**Tylko import** — dodaje pozycje do biblioteki Zotero na serwerze (DOI / ORCID → kolekcja badania).

**Nie wstawia** cytowań ani bibliografii w dokumencie. Apps Script nie ma dostępu do kursora w edytorze Docs ani do field codes Zotero — to ograniczenie architektury oficjalnej integracji Google Docs (logika cytowań jest w **Connectorze**, nie w Apps Script).

## Script Properties

| Klucz | Wartość |
|-------|---------|
| `ZOTERO20_API_KEY` | klucz z `server/.env` (wymagany) |

## Użycie

1. Rozszerzenia → **Zotero20** → Otwórz panel importu.
2. Importuj DOI lub ORCID do wybranego badania.
3. Po imporcie DOI: panel **„Wstaw cytowanie w kursorze”** wysyła `postMessage` do Connectora (patrz niżej).
4. Jeśli Connector nie reaguje — ręcznie: menu **Zotero → Dodaj/edytuj cytowanie**.

## Cytowania i bibliografia (Connector)

| Funkcja | Gdzie |
|---------|--------|
| Wstaw/edytuj cytowanie w kursorze | Menu **Zotero** (Zotero20 Connector) |
| Bibliografia | **Zotero → Dodaj/edytuj bibliografię** |
| Styl (APA, IEEE, …) | **Zotero → Preferencje dokumentu** |
| Odświeżenie pól | **Zotero → Refresh** |
| Odlinkowanie | **Zotero → Unlink Citations** |

Wymaga zbudowanego i załadowanego **Zotero20 Connector** (`connector/setup.sh` → build → Load unpacked).

## Protokół sidebar → Connector (postMessage)

Po imporcie DOI sidebar wysyła do `window.parent`:

```json
{
  "source": "zotero20-sidebar",
  "action": "addEditCitation",
  "itemKey": "ABC123XY",
  "doi": "10.1038/...",
  "ts": 1710000000000
}
```

Connector (content script na `docs.google.com`) powinien nasłuchiwać i wywołać `addEditCitation` — patrz `connector/README.md` (patch planowany w Fazie 2).

**Dziś:** przycisk w sidebarze jest przygotowany; pełna automatyzacja wymaga patcha w fork Connectora. Bez niego użytkownik korzysta z menu Zotero.

## Diagram

```
Google Docs
├── Menu Zotero (Connector)     ← cytowania, bibliografia, refresh, styl
└── Panel Zotero20 Import       ← tylko import DOI/ORCID do biblioteki
         │
         └── postMessage ──► Connector (planowane: auto addEditCitation)
```
