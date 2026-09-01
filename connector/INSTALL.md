# Zotero20 Connector — instalacja w Chrome i Firefox

Fork [zotero-connectors](https://github.com/zotero/zotero-connectors) dla zdalnego Zotero Desktop (`https://zotero.keyweb.pl`) z autoryzacją **X-API-Key**.

## Wymagania

| Narzędzie | Wersja | Uwagi |
|-----------|--------|--------|
| Git | dowolna | klon upstream |
| Node.js | 18+ | `npm install` |
| Bash | Git Bash / WSL / Linux / macOS | `setup.sh` i `build.sh` |
| Chrome | 120+ | Manifest V3 (Load unpacked) |
| Firefox | 115+ | Manifest V2 (tymczasowy dodatek lub XPI) |

**Windows:** najprościej **Docker** (bez WSL i ręcznych komend bash) — patrz sekcja poniżej. Alternatywnie Git Bash do `setup.sh`; build (`build.sh`) wymaga `rsync` i `jq` — na czystym Windows **nie zadziała** bez WSL/Linuxa/macOS lub artefaktu z GitHub Actions (`build-connector.yml`).

**Node.js:** zalecane 20+ (CI używa Node 20). Lokalnie Node 18 może działać z ostrzeżeniami.

## Build przez Docker (zalecane na Windows)

Wymaga [Docker Desktop](https://www.docker.com/products/docker-desktop/). Jedna komenda z katalogu `connector`:

```powershell
docker compose build connector
docker compose run --rm connector
```

Skrót PowerShell (Chrome + Firefox):

```powershell
.\build-connector.ps1
```

Tylko Firefox:

```powershell
.\build-firefox.ps1
```

Po sukcesie:
- **Chrome** — załaduj folder `connector/upstream/build/manifestv3` (Load unpacked)
- **Firefox** — patrz sekcja [Firefox](#firefox) poniżej

## Krok 1 — przygotowanie źródeł (bez Dockera)

```bash
cd connector
./setup.sh
```

Skrypt:
1. Klonuje `zotero-connectors` do `connector/upstream/`
2. Inicjalizuje submoduły (Google Docs integration, translate, …)
3. Nakłada patche Zotero20 (URL, API key, postMessage, branding)

## Krok 2 — build

```bash
cd upstream
npm install
./build.sh
```

Po sukcesie gotowe wtyczki:

```
connector/upstream/build/manifestv3/   # Chrome (MV3)
connector/upstream/build/firefox/      # Firefox (MV2)
connector/upstream/build/zotero20-connector-firefox.xpi   # opcjonalny pakiet XPI
```

> **CI:** build na GitHub Actions — artefakty `zotero20-connector-chrome` i `zotero20-connector-firefox` w workflow `build-connector.yml` (przydatne bez Linuxa/WSL lokalnie).

## Krok 3 — załaduj w Chrome

1. Otwórz `chrome://extensions`
2. Włącz **Tryb deweloperski** (prawy górny róg)
3. **Załaduj rozpakowane** → wybierz folder:
   ```
   connector/upstream/build/manifestv3
   ```
4. Przypnij ikonę Zotero20 Connector na pasku (opcjonalnie)

## Firefox

Build (`./build.sh` lub Docker) tworzy folder MV2 obok Chrome:

```
connector/upstream/build/firefox/
```

Opcjonalnie spakowany plik `.xpi` (zawartość folderu `firefox/`):

```
connector/upstream/build/zotero20-connector-firefox.xpi
```

### Załaduj w Firefox (tymczasowo)

1. Otwórz `about:debugging#/runtime/this-firefox`
2. Kliknij **Załaduj tymczasowy dodatek…** (ang. *Load Temporary Add-on…*)
3. Wybierz plik `manifest.json` z folderu:
   ```
   connector/upstream/build/firefox/manifest.json
   ```
   (możesz też wskazać plik `.xpi` z powyższej ścieżki)
4. Ikona Zotero20 Connector pojawi się na pasku narzędzi

> **Uwaga:** tymczasowy dodatek znika po restarcie Firefoxa. Aby zachować go na stałe, potrzebny jest podpisany XPI (np. przez Mozilla Add-ons) — poza zakresem tego repozytorium.

### Konfiguracja (Firefox)

Ta sama co w Chrome — **Preferences → Advanced → Config Editor**:

| Pref | Wartość |
|------|---------|
| `connector.url` | `https://zotero.keyweb.pl/` |
| `zotero20.apiKey` | ten sam klucz co `ZOTERO20_API_KEY` w `server/.env` |

Po zmianie prefów odśwież kartę Google Docs.

## Krok 4 — konfiguracja Chrome (jednorazowo)

1. Kliknij ikonę wtyczki → **Preferences** (Ustawienia)
2. Zakładka **Advanced** → **Config Editor**
3. Ustaw:

| Pref | Wartość |
|------|---------|
| `connector.url` | `https://zotero.keyweb.pl/` |
| `zotero20.apiKey` | ten sam klucz co `ZOTERO20_API_KEY` w `server/.env` |

4. Zamknij i otwórz ponownie kartę Google Docs

### Weryfikacja połączenia

W Chrome DevTools (tło wtyczki) lub po próbie zapisu — brak komunikatu „Zotero is offline”. Alternatywnie:

```bash
curl -sS -H "X-API-Key: TWOJ_KLUCZ" https://zotero.keyweb.pl/connector/ping
```

## Krok 5 — Google Docs

1. Otwórz [docs.google.com](https://docs.google.com) — dowolny dokument z uprawnieniami do edycji
2. Na pasku menu pojawi się **Zotero** (jak w oficjalnym Connectorze)
3. Zainstaluj panel importu (osobno): patrz [docs/google-docs-setup.md](../docs/google-docs-setup.md)

### Pełny workflow

```
Import DOI (sidebar) → Wstaw cytowanie (przycisk lub menu Zotero)
                    → Add/Edit Bibliography
                    → Document Preferences (styl)
                    → Refresh (po zmianie metadanych)
```

## Aktualizacja wtyczki

```bash
cd connector
rm -rf upstream          # opcjonalnie: świeży klon
./setup.sh
cd upstream && npm install && ./build.sh
```

W Chrome: `chrome://extensions` → ikona odświeżenia przy Zotero20 Connector.

W Firefox: usuń stary dodatek w `about:debugging` i załaduj ponownie z `build/firefox/manifest.json` (lub nowego `.xpi`).

## Rozwiązywanie problemów

| Objaw | Rozwiązanie |
|-------|-------------|
| Brak menu Zotero w Docs | Sprawdź, czy wtyczka włączona; odśwież dokument |
| „Zotero is offline” | `connector.url`, `zotero20.apiKey`, dostęp do `zotero.keyweb.pl` |
| Przycisk sidebara nie otwiera dialogu | Odśwież Docs; użyj **Zotero → Dodaj/edytuj cytowanie** |
| Build fail na Windows | `.\build-connector.ps1` lub `.\build-firefox.ps1` w `connector/`, WSL (`build-wsl.sh`) lub artefakt z GitHub Actions |
| `gulp not found` | `cd upstream && npm install` |

## Co fork zmienia w upstream

| Obszar | Zmiana |
|--------|--------|
| `connector.url` | tunel zamiast `127.0.0.1:23119` |
| `connector.js` | nagłówek `X-API-Key` |
| Google Docs `ui.jsx` | most `postMessage` z sidebara importu |
| `manifest.json` | nazwa „Zotero20 Connector” |

Logika cytowań (field codes, NamedRanges, citeproc) **bez zmian** — pochodzi z upstream.
