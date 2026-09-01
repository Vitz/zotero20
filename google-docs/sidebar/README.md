# Panel importu ORCID/DOI (Zotero20 Import)

Base URL: `https://zotero.keyweb.pl/api/v1`

## Co robi ten sidebar (dziś)

**Tylko import** — dodaje pozycje do biblioteki Zotero na serwerze (DOI / ORCID → kolekcja badania).

**Nie wstawia** cytowań ani bibliografii w dokumencie. Apps Script nie ma dostępu do kursora w edytorze Docs ani do field codes Zotero — to ograniczenie architektury oficjalnej integracji Google Docs (logika cytowań jest w **Connectorze**, nie w Apps Script).

## Script Properties

| Klucz | Wartość |
|-------|---------|
| `ZOTERO20_API_KEY` | klucz z `server/.env` (wymagany) |
| `ZOTERO20_DEFAULT_COLLECTION_KEY` | 8-znakowy klucz kolekcji Zotero (ustawiany w panelu, zakładka Ustawienia) |
| `ZOTERO20_DEFAULT_COLLECTION_NAME` | nazwa kolekcji (cache do wyświetlania) |

## Użycie

1. Rozszerzenia → **Zotero20** → Otwórz panel importu.
2. **Jednorazowo:** zakładka **Ustawienia** → wybierz domyślną kolekcję Zotero → **Zapisz**.
3. Importuj DOI lub ORCID — trafiają automatycznie do zapisanej kolekcji (bez wyboru przy każdym imporcie).
4. Po imporcie DOI: panel **„Wstaw cytowanie w kursorze”** wysyła `postMessage` do Connectora (patrz niżej).
5. Jeśli Connector nie reaguje — ręcznie: menu **Zotero → Dodaj/edytuj cytowanie**.

Opcjonalnie: sekcja **Zaawansowane** nadpisuje badaniem z `studies.yaml` (dla zespołów z wieloma badaniami). Pojedynczy użytkownik może pominąć `studies.yaml`.

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

Connector (content script na `docs.google.com`) nasłuchuje i wywołuje `addEditCitation` — patrz `connector/patches/003-sidebar-postmessage.patch`.

**Fallback:** jeśli Connector nie reaguje, użyj menu **Zotero → Dodaj/edytuj cytowanie**.

## Diagram

```
Google Docs
├── Menu Zotero (Connector)     ← cytowania, bibliografia, refresh, styl
└── Panel Zotero20 Import       ← tylko import DOI/ORCID do biblioteki
         │
         └── postMessage ──► Connector (addEditCitation)
```

## Troubleshooting

| Objaw | Przyczyna | Rozwiązanie |
|-------|-----------|-------------|
| „Ustaw domyślną kolekcję” | Brak zapisanej kolekcji w Script Properties | Zakładka **Ustawienia** → wybierz kolekcję → Zapisz |
| Pusta lista kolekcji | Serwer bez `ZOTERO_WEB_API_KEY` (fallback Local API) albo biblioteka Docker pusta | Sprawdź `GET /api/v1/collections` — pole `"source"` powinno być `"web"`. Po deploy odśwież panel. Wpisz klucz ręcznie w Ustawieniach (np. `FVIAD3D8`) |
| Tekst „Local API” w panelu | Stara wersja sidebara (przed `clasp push`) | `clasp push` z `google-docs/sidebar/`, zamknij i otwórz panel ponownie |
| „Nieprawidłowy klucz API” | Zły `ZOTERO20_API_KEY` | Ustaw ten sam klucz co w `.env` na serwerze |
| Zaawansowane: brak badań | Brak `studies.yaml` | Normalne dla jednego użytkownika — użyj domyślnej kolekcji |

Test z serwera:

```bash
curl -sS -H "X-API-Key: $ZOTERO20_API_KEY" https://zotero.keyweb.pl/api/v1/collections
curl -sS -H "X-API-Key: $ZOTERO20_API_KEY" https://zotero.keyweb.pl/api/v1/studies
```
