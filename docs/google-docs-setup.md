# Jak dodać Zotero20 do Google Docs

W Google Docs potrzebujesz **dwóch elementów** — jeden odpowiada za cytowania (Refresh, bibliografia), drugi za szybki import źródeł. Oba działają równolegle; nie zastępują się nawzajem.

## Co zachowujemy z oficjalnego Zotero w Docs

Projekt **nie przepisuje** logiki cytowań. Fork Connectora + zdalne Zotero Desktop przenosi tylko **miejsce przechowywania biblioteki i silnika citeproc** — interfejs i zachowanie w dokumencie pozostają takie same.

| Funkcja w menu Zotero w Docs | Po migracji | Jak |
|------------------------------|-------------|-----|
| Add/Edit Citation | tak | citing protocol → serwer |
| Add/Edit Bibliography | tak | citing protocol → serwer |
| Document Preferences (styl APA/IEEE/…) | tak | `setDocPrefs` |
| **Refresh** | **tak** | komenda `refresh` |
| Automatyczna numeracja, przesuwanie cytowań | tak | citeproc-js na serwerze |
| Unlink Citations | tak | `removeCodes` |

**Nie tracisz** Refresh ani przebudowy bibliografii — o ile używasz **Zotero20 Connector** wskazującego na `https://zotero.keyweb.pl`, a na serwerze działa pełne Zotero Desktop.

---

## Element 1: Zotero20 Connector (obowiązkowy do cytowań)

Zastępuje oficjalny [Zotero Connector](https://www.zotero.org/download/connectors). Bez niego nie ma menu Zotero w Google Docs ani Refresh.

### Instalacja

Szczegółowa instrukcja: **[connector/INSTALL.md](../connector/INSTALL.md)**

Skrót:

1. Zbuduj wtyczkę (`connector/setup.sh` → `npm install` → `./build.sh`) **lub** pobierz artefakt `zotero20-connector-chrome` z GitHub Actions (`build-connector.yml`)
2. Chrome: `chrome://extensions` → **Tryb deweloperski** → **Załaduj rozpakowane** → folder `connector/upstream/build/manifestv3`
3. Config Editor wtyczki:
   - `connector.url` = `https://zotero.keyweb.pl/`
   - `zotero20.apiKey` = ten sam co `ZOTERO20_API_KEY` w `server/.env`

### Użycie w Google Docs

1. Otwórz [docs.google.com](https://docs.google.com) — dokument z uprawnieniami do edycji
2. Menu **Zotero** na pasku (jak oficjalny Connector)
3. Skróty i pozycje menu: Add Citation, Refresh, Bibliography itd.
4. **Nie instalujesz** nic w samym dokumencie — wystarczy rozszerzenie w przeglądarce

### Wymagania dla współpracy

- Każda osoba edytująca cytowania powinna mieć **Zotero20 Connector** (oficjalna dokumentacja Zotero o unlinking)
- Osoby tylko czytające — bez wymagań
- **Zotero Desktop na PC nie jest potrzebny** — tylko rozszerzenie + internet + klucz API

---

## Element 2: Panel importu ORCID/DOI (sidebar)

Osobny **Google Apps Script** — nie zastępuje menu Zotero, tylko dodaje panel boczny do importu źródeł.

Kod: `google-docs/sidebar/`

### Wdrożenie

**Opcja A — Add-on dla domeny Google Workspace** (zalecane przy zespole):

1. Opublikuj projekt z `google-docs/sidebar/` jako private add-on
2. Użytkownicy: menu **Zotero20** → Otwórz panel importu

**Opcja B — Bound script do szablonu dokumentu**:

1. Utwórz szablon Google Doc
2. **Extensions → Apps Script** — `clasp push` z repo
3. Udostępnij szablon współautorom

**Opcja C — clasp (dev)**:

```bash
cd google-docs/sidebar
clasp login
clasp create --type docs --title "Zotero20 Import"
clasp push
```

W Apps Script: **Deploy → Test deployments** → autorizuj uprawnienia.

### Konfiguracja (jednorazowo)

W **Project Settings → Script properties**:

| Klucz | Wartość |
|-------|---------|
| `ZOTERO20_API_KEY` | ten sam co `ZOTERO20_API_KEY` w `server/.env` |

Domyślna kolekcja ustawiana **w panelu** (zakładka Ustawienia) — nie trzeba ręcznie wpisywać `collection_key`.

### Workflow użytkownika

1. Otwórz dokument (z Zotero20 Connector)
2. Menu **Zotero20** → **Otwórz panel importu**
3. **Jednorazowo:** zakładka **Ustawienia** → wybierz domyślną kolekcję → **Zapisz**
4. Zakładka **DOI** lub **ORCID** → import
5. Po imporcie DOI: **Wstaw cytowanie w kursorze** (most do Connectora) lub menu **Zotero → Dodaj/edytuj cytowanie**
6. **Zotero → Dodaj/edytuj bibliografię** — bibliografia
7. **Zotero → Preferencje dokumentu** — styl cytowań
8. **Zotero → Refresh** — po zmianie metadanych w Zotero

Opcjonalnie: sekcja **Zaawansowane** nadpisuje badaniem z `studies.yaml` (dla wielu badań w zespole).

---

## Protokół sidebar → Connector

Po imporcie DOI sidebar wysyła `postMessage` do strony Docs:

```json
{
  "source": "zotero20-sidebar",
  "action": "addEditCitation",
  "itemKey": "ABC123XY",
  "doi": "10.1038/...",
  "ts": 1710000000000
}
```

Zotero20 Connector (patch `003-sidebar-postmessage.patch`) nasłuchuje i wywołuje `addEditCitation`.

Jeśli dialog się nie otworzy — użyj menu **Zotero → Dodaj/edytuj cytowanie** (fallback zawsze działa).

---

## API Django (sidebar)

Base URL: `https://zotero.keyweb.pl/api/v1`

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/collections` | GET | lista kolekcji Zotero (do wyboru w Ustawieniach) |
| `/studies` | GET | opcjonalne badania z `studies.yaml` |
| `/import/doi` | POST | `{ "doi", "collection_key" }` lub `{ "doi", "study" }` |
| `/import/orcid` | POST | `{ "orcid", "collection_key", "limit" }` |

Nagłówek: `X-API-Key: <ZOTERO20_API_KEY>`

Test:

```bash
curl -sS -H "X-API-Key: $ZOTERO20_API_KEY" https://zotero.keyweb.pl/api/v1/collections
curl -sS -H "X-API-Key: $ZOTERO20_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"doi":"10.1038/nature12373","collection_key":"ABCD1234"}' \
  https://zotero.keyweb.pl/api/v1/import/doi
```

---

## Diagram

```
Google Docs
├── Pasek menu: [Plik] [Edycja] … [Zotero ▼]     ← Zotero20 Connector
│       ├── Add/Edit Citation
│       ├── Add/Edit Bibliography
│       ├── Preferences
│       ├── Refresh
│       └── Unlink Citations
│
└── Panel boczny: Zotero20 Import               ← Apps Script
        ├── Ustawienia (domyślna kolekcja)
        ├── Import DOI / ORCID
        └── postMessage → Connector (addEditCitation)
```

---

## Checklist

- [ ] Menu **Zotero** widoczne w Google Docs
- [ ] `connector.url` i `zotero20.apiKey` ustawione w Config Editor
- [ ] Add Citation pokazuje pozycje z biblioteki serwerowej
- [ ] **Refresh** aktualizuje cytowania po zmianie metadanych
- [ ] Sidebar: domyślna kolekcja zapisana, import DOI działa
- [ ] Po imporcie: przycisk „Wstaw cytowanie” lub menu Zotero
- [ ] Bibliografia i styl przez menu Zotero

---

## Częste pytania

**Czy muszę coś instalować w samym Google Doc?**  
Nie dla cytowań — tylko rozszerzenie Chrome. Sidebar wymaga add-onu lub bound script (`clasp push`).

**Czy mogę używać oficjalnego Connectora?**  
Nie — nie obsługuje zdalnego URL ani `X-API-Key`. Refresh nie połączy się z serwerem.

**Czy Web API zotero.org wystarczy do Refresh?**  
Nie. Refresh wymaga **Zotero Desktop HTTP server** (`/connector/document/*`).

**Czy potrzebuję studies.yaml?**  
Nie dla pojedynczego użytkownika — wystarczy domyślna kolekcja w panelu. `studies.yaml` jest opcjonalny dla wielu badań.
