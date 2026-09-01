# Panel importu ORCID/DOI (Zotero20 Import)

Base URL: `https://zotero.keyweb.pl/api/v1`

## Co robi ten sidebar (dziś)

**Import** — dodaje pozycje do biblioteki Zotero na serwerze (DOI / ORCID → kolekcja badania).

**Proste wstawianie cytowań** — zamienia placeholder w tekście dokumentu na skrót `(Autor, rok)`:
- wpisz w dokumencie `[*]` albo `[10.1038/...]` / `[doi:...]` przed importem,
- po imporcie DOI placeholder zostanie zamieniony automatycznie (albo użyj przycisku **Wklej zamiast [*]**).

To **nie** są field codes Zotero — nie odświeżają się po zmianie stylu. Pełne cytowania (APA, numeracja, bibliografia, Refresh) nadal wymagają menu **Zotero** przez **Zotero20 Connector**.

## Script Properties

| Klucz | Wartość |
|-------|---------|
| `ZOTERO20_API_KEY` | klucz z `server/.env` (wymagany) |
| `ZOTERO20_DEFAULT_COLLECTION_KEY` | 8-znakowy klucz kolekcji Zotero (ustawiany w panelu, zakładka Ustawienia) |
| `ZOTERO20_DEFAULT_COLLECTION_NAME` | nazwa kolekcji (cache do wyświetlania) |

## Użycie

1. Rozszerzenia → **Zotero20** → Otwórz panel importu.
2. **Jednorazowo:** zakładka **Ustawienia** → wybierz domyślną kolekcję Zotero → **Zapisz**.
3. W dokumencie wpisz placeholder: `[*]` lub `[10.1038/...]` (DOI importowanej pracy).
4. Importuj DOI lub ORCID — trafiają automatycznie do zapisanej kolekcji.
5. Po imporcie DOI: jeśli placeholder jest w dokumencie, zostanie zamieniony na `(Autor, rok)`. W razie potrzeby użyj **Wklej zamiast [*]**.
6. Pełne cytowania Zotero (field codes, bibliografia, Refresh): menu **Zotero → Dodaj/edytuj cytowanie**.

Opcjonalnie: sekcja **Zaawansowane** nadpisuje badaniem z `studies.yaml` (dla zespołów z wieloma badaniami). Pojedynczy użytkownik może pominąć `studies.yaml`.

## Cytowania i bibliografia (Connector)

| Funkcja | Gdzie |
|---------|--------|
| Prosty tekst `(Autor, rok)` zamiast `[*]` | Panel **Zotero20 Import** (Apps Script) |
| Wstaw/edytuj cytowanie (field codes) | Menu **Zotero** (Zotero20 Connector) |
| Bibliografia | **Zotero → Dodaj/edytuj bibliografię** |
| Styl (APA, IEEE, …) | **Zotero → Preferencje dokumentu** |
| Odświeżenie pól | **Zotero → Refresh** |
| Odlinkowanie | **Zotero → Unlink Citations** |

Wymaga zbudowanego i załadowanego **Zotero20 Connector** (`connector/setup.sh` → build → Load unpacked).

## Placeholdery w dokumencie

Kolejność wyszukiwania (pierwsze trafienie w dokumencie):

1. `[*]`
2. `[doi]`, `[10.xxxx/...]`, `[doi:10.xxxx/...]` — dla importu DOI
3. `[orcid]`, `[0000-0002-...]` — dla ORCID

Błąd jeśli żaden placeholder nie występuje w tekście.

## Opcjonalnie: postMessage → Connector

Patch `003-sidebar-postmessage` nadal pozwala Connectorrowi otworzyć dialog cytowań po `postMessage`, ale sidebar **domyślnie** używa zamiany placeholderów (nie wymaga kursora ani Connectora do prostego tekstu).

## Diagram

```
Google Docs
├── Menu Zotero (Connector)     ← field codes, bibliografia, refresh, styl
└── Panel Zotero20 Import       ← import DOI/ORCID + zamiana [*] → (Autor, rok)
         │
         └── Apps Script API ──► zotero.keyweb.pl/api/v1
```

## Troubleshooting

| Objaw | Przyczyna | Rozwiązanie |
|-------|-----------|-------------|
| „Ustaw domyślną kolekcję” | Brak zapisanej kolekcji w Script Properties | Zakładka **Ustawienia** → wybierz kolekcję → Zapisz |
| Pusta lista kolekcji | Serwer bez `ZOTERO_WEB_API_KEY` (fallback Local API) albo biblioteka Docker pusta | Sprawdź `GET /api/v1/collections` — pole `"source"` powinno być `"web"`. Po deploy odśwież panel. Wpisz klucz ręcznie w Ustawieniach (np. `FVIAD3D8`) |
| Tekst „Local API” w panelu | Stara wersja sidebara (przed `clasp push`) | `clasp push` z `google-docs/sidebar/`, zamknij i otwórz panel ponownie |
| „Nieprawidłowy klucz API” | Zły `ZOTERO20_API_KEY` | Ustaw ten sam klucz co w `.env` na serwerze |
| „W dokumencie brak [*]…” | Brak placeholdera w tekście | Wpisz `[*]` lub `[DOI]` w dokumencie przed importem / wklejeniem |
| Zaawansowane: brak badań | Brak `studies.yaml` | Normalne dla jednego użytkownika — użyj domyślnej kolekcji |

Test z serwera:

```bash
curl -sS -H "X-API-Key: $ZOTERO20_API_KEY" https://zotero.keyweb.pl/api/v1/collections
curl -sS -H "X-API-Key: $ZOTERO20_API_KEY" https://zotero.keyweb.pl/api/v1/studies
```
