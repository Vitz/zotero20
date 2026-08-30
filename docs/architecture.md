# Architektura techniczna — zotero20

## Przepływ A: Import pozycji (ORCID / DOI)

```
Użytkownik (Google Docs Sidebar)
    │
    │  POST /api/v1/import/orcid
    │  { "orcid": "0000-0001-2345-6789", "study": "badanie-1" }
    ▼
Cloudflare Access (weryfikacja Service Token / API key)
    │
    ▼
Django (api.zotero20.example.com:8000)
    │
    ├─► ORCID Public API
    │       GET /v3.0/{orcid}/works
    │       GET /v3.0/{orcid}/work/{put-code}  (external-ids)
    │
    ├─► Mapowanie study → collectionKey (studies.yaml)
    │
    └─► Zotero Local API (localhost:23119, tylko z RPi)
            POST /api/plus/add-item-by-id
            { "identifier": "<DOI>", "collectionKey": "<key>" }
    │
    ▼
Odpowiedź JSON do Sidebaru
    { "added": 12, "skipped": 3, "errors": [...] }
```

Django **nigdy** nie jest w ścieżce cytowań — tylko zapis do biblioteki.

## Przepływ B: Cytowania w Google Docs

Oparty na [HTTP Citing Protocol](https://www.zotero.org/support/dev/client_coding/http_integration_protocol).

```
Google Docs (edytor)
    │
    ▼
Fork Zotero Connector (content script w docs.google.com)
    │
    ├─► Google Docs API — odczyt/zapis dokumentu (field codes, NamedRanges)
    │
    └─► Zotero przez tunel
            POST https://zotero.zotero20.example.com/connector/document/execCommand
            POST .../connector/document/respond
            (pętla transaction do complete)
    │
    ▼
Zotero Desktop na RPi
    ├─ citeproc-js (styl APA/IEEE/Vancouver)
    ├─ numeracja, ibid, disambiguation
    └─ zwraca komendy do aktualizacji tekstu w dokumencie
```

### Komendy citing protocol (używane przez Docs)

| Komenda | Zastosowanie |
|---------|--------------|
| `addEditCitation` | Wstaw/edytuj cytowanie |
| `addEditBibliography` | Bibliografia |
| `refresh` | Odśwież wszystkie pola |
| `setDocPrefs` | Styl cytowań |
| `removeCodes` | Unlink citations |

Connector implementuje klienta protokołu; Zotero na serwerze — serwer.

## Porty i binding

| Usługa | Bind | Port | Ekspozycja |
|--------|------|------|------------|
| Zotero httpServer | 127.0.0.1 | 23119 | Tylko przez cloudflared |
| Django | 127.0.0.1 | 8000 | Tylko przez cloudflared |
| cloudflared | — | — | Publiczny HTTPS (CF edge) |

**Zasada:** Zotero nie binduje na `0.0.0.0`. Tunel kończy się na localhost wewnątrz RPi.

## Identyfikacja instancji (Zotero 10+)

Local API zwraca nagłówek `Zotero-Server-ID`. Klienty zapisujące stan między sesjami powinny partycjonować cache po tym ID. Po reinstalacji Zotero na RPi ID się zmieni — Connector i cache trzeba odświeżyć.

## Mapowanie badań

Logiczna struktura w Zotero:

```
Moja biblioteka
├── Badanie 1          (collectionKey: ...)
├── Badanie 2
└── Wspólne / Inne
```

Sidebar wysyła `study: "badanie-1"` (slug), Django mapuje na `collectionKey`. Slugi stabilne w config; klucze Zotero mogą się zmienić przy migracji — config na serwerze, nie w GAS.

## ORCID — ograniczenia

- Nie każda praca w ORCID ma DOI.
- Część ma tylko tytuł i typ — wymaga ręcznego uzupełnienia lub wyszukiwania CrossRef po tytule (faza opcjonalna).
- ORCID API: limit ~24 req/s (public); batch z opóźnieniem między requestami.

## Współpraca wieloosobowa

| Rola | Wymagania |
|------|-----------|
| Autor cytujący | Fork Connector + dostęp do dokumentu |
| Autor tylko tekstu | Oficjalnie ryzyko unlinking — Zotero zaleca Connector wszystkim |
| Admin biblioteki | SSH do RPi, panel Zotero (opcjonalnie VNC) |

Wszyscy cytujący używają **tej samej** instancji Zotero na serwerze (wspólna biblioteka).

## Alternatywy odrzucone

| Podejście | Powód odrzucenia |
|-----------|------------------|
| Tylko Zotero Web API | Brak citing protocol; Refresh w Docs wymaga Desktop API |
| citeproc-py w Django | Duplikacja logiki numeracji i stylów |
| Lokalny PC + sync | Cel projektu: niezależność od PC |
| Publiczny 23119 bez CF Access | Krytyczne zagrożenie bezpieczeństwa |
