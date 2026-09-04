# Panel Zotero20 (import + śledzone cytowania + bibliografia)

Base URL: `https://zotero.keyweb.pl/api/v1`
Wersja plików Apps Script: **2.2.0** (`ADDON_VERSION` w `Code.gs` = `SIDEBAR_VERSION` w `Sidebar.html`).

## Co robi panel

**Import** — dodaje pozycje do biblioteki Zotero na serwerze (DOI / ORCID / ręczne „Inne” → kolekcja).
Opcjonalnie Gemini (klucz tylko na serwerze) uzupełnia pola z wklejonego tekstu.

**Śledzone cytowania w tekście** — wstawia cytowanie w miejscu kursora (albo zamiast `[*]`) i oznacza je
ukrytą kotwicą-linkiem `https://zotero.keyweb.pl/cite/<ITEMKEY>?c=<id>&t=<tytuł>`.
Kotwica:

- przeżywa zamknięcie i ponowne otwarcie dokumentu,
- przeżywa kopiowanie tekstu, cofanie zmian i zrobienie kopii pliku,
- pozwala odnaleźć wszystkie cytowania skanowaniem dokumentu (bez rejestru w `DocumentProperties`).

Google Docs na najechanie **zawsze pokazuje sam URL** (nie ma API na własny dymek). Dlatego w adresie
jest parametr `t=` z krótkim tytułem (autor+rok albo skrócony tytuł pracy) — da się go odczytać z linku.
Kliknięcie `[1]` otwiera publiczną kartę pracy (`GET /cite/<ITEMKEY>`), bez klucza API. Parametry `c=` i `t=`
są ignorowane przy wyświetlaniu.

**Bibliografia tylko z cytowanych pozycji** — budowana wyłącznie z kotwic znalezionych w dokumencie,
w kolejności cytowania. Tryb „cała kolekcja” to osobny, domyślnie wyłączony przełącznik — panel
**nigdy** nie przełącza się na niego sam.

**Wspólny styl** — jeden wybór stylu CSL steruje jednocześnie cytowaniami w tekście i bibliografią.
Przycisk **Zmień styl (cytowania + bibliografia)** przelicza jedno i drugie z tej samej odpowiedzi serwera
(`POST /api/v1/citations`), więc format i numeracja nie mogą się rozjechać.

### Style numeryczne

Dla IEEE i Vancouver numery `[1]`, `[2]` nadaje serwer według kolejności cytowania w dokumencie,
a bibliografia jest w tej samej kolejności. Style autor–rok (APA, Chicago, Harvard, MLA)
dostają bibliografię posortowaną alfabetycznie.

Sąsiednie cytowania numeryczne (`[1][2]` albo `[1] [2]`, bez innego tekstu między nimi) są
po odświeżeniu stylu składane do `[1,2]` — jak w Zotero przy wielu pozycjach w jednym polu.
Kotwice zostają na samych cyfrach (nawiasy i przecinek bez linku), więc skaner nadal widzi
każdą pozycję osobno. **Nie** składamy zakresów `[1-3]`: środkowy numer zniknąłby z tekstu
i stracilibyśmy kotwicę. Przy zmianie na styl autor–rok grupa wraca do osobnych cytowań
obok siebie.

### Czego to nadal nie robi

To **nie** są field codes Zotero. Bez Connectora nie ma: `ibid.`, skracania powtórzonych cytowań,
lokatorów (strony), klikalnego linku cytat → wpis bibliografii, ani pełnego multi-cite z dialogu
(„dodaj kilka pozycji naraz” — tu składa się tylko to, co już stoi obok siebie w dokumencie).
Apps Script nie ma API do pól dokumentu — kotwica-link to najbliższy możliwy odpowiednik.

## Instalacja bez clasp (kopiowanie ręczne)

1. Google Docs → **Rozszerzenia → Apps Script**.
2. Podmień **oba** pliki, zawsze razem:
   - `Code.gs` ← `google-docs/sidebar/Code.gs`
   - `Sidebar.html` ← `google-docs/sidebar/Sidebar.html`
3. Zapisz projekt, wróć do dokumentu i odśwież stronę (F5).
4. **Zotero20 → Otwórz panel importu**.

Jeśli skopiujesz tylko jeden plik, panel wyświetli czerwone ostrzeżenie o niezgodnych wersjach —
to zabezpieczenie przed „naprawami, które nie działają, bo w Docs jest stary kod”.

## Script Properties

| Klucz | Wartość |
|-------|---------|
| `ZOTERO20_API_KEY` | klucz z `server/.env` (wymagany) |
| `ZOTERO20_DEBUG` | opcjonalnie `true` — tryb diagnostyczny |

Ustawienia per dokument (Document Properties, ustawiane z panelu):
`ZOTERO20_DEFAULT_COLLECTION_KEY`, `ZOTERO20_DEFAULT_COLLECTION_NAME`,
`ZOTERO20_BIBLIOGRAPHY_STYLE`, `ZOTERO20_BIBLIOGRAPHY_CITED_ONLY`, `ZOTERO20_CITATION_INSERT_MODE`,
`ZOTERO20_CITATION_LOCALE` (`en-US` albo `pl-PL`; domyślnie `en-US` — „et al.”),
`ZOTERO20_BIBLIOGRAPHY_FONT` (np. `Arial`, `Times New Roman`; puste = domyślna dokumentu),
`ZOTERO20_BIBLIOGRAPHY_FONT_SIZE` (9–14 pt; puste = bez wymuszania).
Kolekcja i styl były wcześniej globalne (Script Properties) i przeciekały między dokumentami —
przy pierwszym odczycie w danym dokumencie wartość z Script Properties jest kopiowana do Document Properties.

## Użycie

1. **W każdym dokumencie:** zakładka **Ustawienia** → wybierz kolekcję tego dokumentu → **Zapisz**
   (albo **Utwórz kolekcję**). Tam też ustaw **Język cytowań** (English = *et al.*, Polski = *i in.*)
   oraz **Wygląd bibliografii** (czcionka / rozmiar). Panel zostaje po polsku.
2. Zakładka **Cytowania** → wybierz styl CSL i tryb wstawiania (kursor / `[*]`).
3. Zakładka **DOI** → zaimportuj pracę. Zakładka **Inne** → książka / preprint / rozdział (ręcznie lub Gemini).
4. Ustaw kursor w dokumencie → **Wstaw cytowanie**. Cytowanie zostaje kotwicą.
5. Zakładka **Cytowania** → **Wstaw bibliografię** (tylko cytowane pozycje).
6. Zmiana stylu albo języka cytowań: **Zmień styl (cytowania + bibliografia)** — przelicza istniejące wpisy.

Wstawienie kolejnego cytowania automatycznie przelicza numerację i odświeża bibliografię,
jeśli już istnieje w dokumencie.

## Migracja z wersji 1.x

Cytowania wstawione starą wersją były oznaczane `NamedRange` + rejestrem `ZOTERO20_CITATION_RANGES`.
Przy pierwszym uruchomieniu wersji 2.0.0 panel jednorazowo konwertuje zachowane zakresy na kotwice-linki
i czyści stary rejestr. Cytowania, których `NamedRange` już nie istnieje (typowa przyczyna komunikatu
„brak śledzonych cytowań”), trzeba wstawić ponownie.

## Sprawdzenie, czy serwer ma aktualny kod

`GET https://zotero.keyweb.pl/api/v1/health` (publiczny, szybki) zwraca `status` + `build` z tagiem wdrożonego obrazu — bez pingowania Zotero.
Jeśli pola `build` **nie ma**, domena kieruje na starą instancję i nowe endpointy (`/citations`)
nie będą działać, nawet gdy GitHub Actions pokazuje udany deploy.

`GET /api/v1/health/zotero` (wymaga `X-API-Key`) sprawdza połączenie Django ↔ Zotero (Web API lub Local).
Panel pokazuje obie kropki statusu (API / Zotero) przy tytule i odświeża je co ~3 s.

## Endpointy używane przez panel

| Endpoint | Do czego |
|----------|----------|
| `GET /health` | liveness API (kropka „API”) |
| `GET /health/zotero` | połączenie z Zotero (kropka „Zotero”) |
| `GET /styles` | lista stylów CSL |
| `GET /items/<key>?style=&locale=` | tekst cytowania pojedynczej pozycji (`locale`: `en-US` / `pl-PL`, domyślnie `en-US`) |
| `POST /citations` | cytowania w tekście **i** bibliografia dla listy `item_keys` (jeden styl + `locale`) |
| `POST /bibliography` | bibliografia z `item_keys` albo z `collection_key` (tryb awaryjny) |
| `POST /import/manual` | ręczne utworzenie pozycji (zakładka Inne) |
| `POST /import/describe` | Gemini → draft pól (bez zapisu; wymaga `GEMINI_API_KEY` na serwerze) |

## Troubleshooting

| Objaw | Przyczyna | Rozwiązanie |
|-------|-----------|-------------|
| Czerwone „Niezgodne wersje plików” | Skopiowano tylko `Code.gs` albo tylko `Sidebar.html` | Skopiuj oba pliki i odśwież dokument |
| „i in.” zamiast „et al.” w cytowaniu APA | Język cytowań ustawiony na Polski (`pl-PL`) albo stary serwer bez `locale` | Ustawienia → **English — et al.**, potem **Zmień styl** |
| „Brak cytowań w dokumencie…” przy bibliografii | W dokumencie nie ma kotwic (np. tekst wklejony ręcznie albo cytowania z wersji 1.x) | Wstaw cytowania przyciskiem **Wstaw cytowanie** |
| Bibliografia z całej kolekcji zamiast cytowanych | Włączony przełącznik **Wstaw CAŁĄ kolekcję** | Zakładka Cytowania → rozwiń „Tryb awaryjny” → odznacz |
| „Nie widzę kursora w dokumencie” | Kursor nigdy nie był ustawiony w tekście | Kliknij w dokument w miejscu cytowania, potem **Wstaw cytowanie** |
| „Brak placeholdera” | Tryb placeholderów, brak dopasowania w tekście | Wpisz `[*]`, `[DOI]`, `[10.xxxx/…]` lub `[DOI:10.xxxx/…]`, albo przełącz tryb na „w miejscu kursora” |
| „Brak bibliografii w dokumencie” przy odświeżaniu | Sekcja została usunięta z dokumentu | Użyj **Wstaw bibliografię** |
| Pusta lista kolekcji | Serwer bez `ZOTERO_WEB_API_KEY` albo pusta biblioteka Docker | Sprawdź `GET /api/v1/collections` (`"source"` = `"web"`), albo wpisz klucz kolekcji ręcznie |
| Szara kropka „Zotero” | Brak `ZOTERO20_API_KEY` w Script Properties | Ustaw klucz jak w `.env` na serwerze |
| Czerwona kropka „API” | Serwer / domena niedostępna | Sprawdź `curl …/api/v1/health` i deploy |
| Czerwona kropka „Zotero” | Zotero Web/Local API nie odpowiada | Sprawdź `curl -H "X-API-Key: …" …/api/v1/health/zotero` |
| „Nieprawidłowy klucz API” | Zły `ZOTERO20_API_KEY` | Ustaw ten sam klucz co w `.env` na serwerze |

Test z serwera:

```bash
curl -sS -H "X-API-Key: $ZOTERO20_API_KEY" https://zotero.keyweb.pl/api/v1/styles
curl -sS -H "X-API-Key: $ZOTERO20_API_KEY" -H "Content-Type: application/json" \
  -d '{"item_keys":["ITEMKEY1","ITEMKEY2"],"style":"ieee"}' \
  https://zotero.keyweb.pl/api/v1/citations
```

## Cytowania pełne (Connector)

| Funkcja | Gdzie |
|---------|--------|
| Śledzone cytowania + bibliografia z cytowanych | Panel **Zotero20** (Apps Script) |
| Wstaw/edytuj cytowanie (field codes), `ibid.`, lokatory | Menu **Zotero** (Zotero20 Connector) |
| Odświeżenie pól / odlinkowanie | **Zotero → Refresh / Unlink Citations** |

Wymaga zbudowanego i załadowanego **Zotero20 Connector** (`connector/setup.sh` → build → Load unpacked).
