# 003 — postMessage z panelu Zotero20 Import

**Status:** zastosowany w `setup.sh` (`003-sidebar-postmessage.patch`)

## Cel

Panel Apps Script (`google-docs/sidebar/`) po imporcie DOI wysyła:

```json
{
  "source": "zotero20-sidebar",
  "action": "addEditCitation",
  "itemKey": "<klucz Zotero lub null>",
  "doi": "<doi>",
  "ts": <unix ms>
}
```

Connector na `docs.google.com` powinien wywołać `Zotero.GoogleDocs.execCommand('addEditCitation')`.

## Gdzie w upstream

Szukaj pliku integracji Google Docs w `zotero-connectors`, np.:

- `src/common/inject/googleDocs.js` lub podobna ścieżka (layout upstream się zmienia)

## Uwagi

- Apps Script **nie może** sam wstawić field code Zotero — tylko Connector ma dostęp do kursora i NamedRanges.
- Preselekcja `itemKey` w dialogu cytowań wymaga rozszerzenia citing protocol po stronie Zotero — poza zakresem minimalnego patcha.
- Bez tego patcha użytkownik używa menu **Zotero → Dodaj/edytuj cytowanie** po imporcie.
