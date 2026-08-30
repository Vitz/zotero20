# Jak dodać zotero20 do Google Docs

W Google Docs potrzebujesz **dwóch elementów** — jeden odpowiada za cytowania (Refresh, bibliografia), drugi za szybki import źródeł. Oba działają równolegle; nie zastępują się nawzajem.

## Co zachowujemy z oficjalnego Zotero w Docs

Projekt **nie przepisuje** logiki cytowań. Fork Connectora + zdalne Zotero Desktop przenosi tylko **miejsce przechowywania biblioteki i silnika citeproc** — interfejs i zachowanie w dokumencie pozostają takie same.

| Funkcja w menu Zotero w Docs | Czy działa po migracji | Jak |
|------------------------------|------------------------|-----|
| Add/Edit Citation | tak | citing protocol → serwer |
| Add/Edit Bibliography | tak | citing protocol → serwer |
| Document Preferences (styl APA/IEEE/…) | tak | `setDocPrefs` |
| **Refresh** (odświeżenie cytowań i metadanych) | **tak** | komenda `refresh` |
| Automatyczna numeracja [1][2][3], przesuwanie po wstawieniu | tak | citeproc-js na serwerze |
| ibid., disambiguation | tak | citeproc-js na serwerze |
| Unlink Citations | tak | `removeCodes` |
| Export Document | tak | `exportDocument` |

**Nie tracisz** Refresh ani przebudowy bibliografii — o ile używasz **forkowanego Connectora** wskazującego na tunel, a na serwerze działa pełne Zotero Desktop (nie Web API samo w sobie).

---

## Element 1: Fork Zotero Connector (obowiązkowy do cytowań)

To zastępuje oficjalny [Zotero Connector](https://www.zotero.org/download/connectors) — bez niego nie ma menu Zotero w Google Docs ani Refresh.

### Instalacja u autora / współautora

1. Pobierz build z repo (`connector/dist/` po `npm run build`) lub sklonuj i zbuduj lokalnie.
2. Chrome: `chrome://extensions` → **Developer mode** → **Load unpacked** → wybierz folder `connector/build/browserSpecific/chrome` (ścieżka po buildzie — doprecyzujemy w Fazie 2).
3. Firefox: `about:debugging` → **Load Temporary Add-on** → plik `manifest.json` z buildu.
4. W opcjach wtyczki (Config Editor) ustaw:
   - `connector.url` = `https://zotero.twojadomena.pl`
   - Service Token CF Access (wbudowany w build lub pola w Options — do ustalenia w fork).

### Użycie w Google Docs

1. Otwórz [docs.google.com](https://docs.google.com) — dowolny dokument.
2. Fork Connector **automatycznie** wstrzykuje menu **Zotero** na pasku (tak jak oficjalny).
3. Skróty i pozycje menu są identyczne: Add Citation, Refresh, Bibliography itd.
4. **Nie instalujesz** nic w samym dokumencie — wystarczy rozszerzenie w przeglądarce.

### Wymagania dla współpracy

- Każda osoba, która **wstawia lub edytuje cytowania**, powinna mieć **ten sam fork Connectora** (oficjalna dokumentacja Zotero o unlinking).
- Osoby tylko czytające dokument — bez wymagań.
- **Zotero Desktop na PC nie jest potrzebny** — tylko rozszerzenie + dostęp do internetu i tunelu.

### Co forkujemy w źródłach (open source)

Repozytorium: [zotero/zotero-connectors](https://github.com/zotero/zotero-connectors) (AGPL).

| Zmiana | Plik / obszar (orientacyjnie) | Cel |
|--------|-------------------------------|-----|
| Domyślny `connector.url` | prefs / config | tunel zamiast `http://127.0.0.1:23119` |
| Nagłówki HTTP | warstwa `fetch` / messaging | `CF-Access-Client-Id`, `CF-Access-Client-Secret` |
| Branding | `manifest.json`, nazwa | „Zotero20 Connector” — rozróżnienie od oficjalnej wtyczki |

**Nie forkujemy** [zotero-google-docs-integration](https://github.com/zotero/zotero-google-docs-integration) osobno — logika Docs jest **wbudowana w Connector** (content script na `docs.google.com`). Po zmianie URL backendu integracja Docs działa bez zmian w field codes / NamedRanges.

Build:

```bash
cd connector
npm install
npm run build
```

---

## Element 2: Panel importu ORCID/DOI (sidebar — opcjonalny, ale to Twój „szybki dodawacz”)

Osobny **Google Apps Script Add-on** — nie zastępuje menu Zotero, tylko dodaje panel boczny.

### Wdrożenie (dla Ciebie / zespołu)

**Opcja A — Add-on dla domeny Google Workspace** (zalecane przy PRZ / zespole):

1. Opublikuj projekt z `google-docs/sidebar/` jako **private add-on** w Google Workspace Admin.
2. Użytkownicy: **Extensions → Zotero20 → Open panel** (lub ikona na pasku bocznym).

**Opcja B — Bound script do szablonu dokumentu**:

1. Utwórz szablon Google Doc „Artykuł z Zotero20”.
2. **Extensions → Apps Script** — wklej kod z repo (`clasp push`).
3. Udostępnij szablon współautorom — każdy tworzy kopię z podpiętym skryptem.

**Opcja C — clasp + ręczny install (dev)**:

```bash
cd google-docs/sidebar
clasp login
clasp create --type docs --title "Zotero20 Import"
clasp push
```

W edytorze Apps Script: **Deploy → Test deployments** → autorizuj uprawnienia do Docs i `UrlFetchApp`.

### Konfiguracja secrets (jednorazowo)

W **Project Settings → Script properties**:

| Klucz | Wartość |
|-------|---------|
| `API_BASE` | `https://api.twojadomena.pl` |
| `CF_ACCESS_CLIENT_ID` | Service Token z Cloudflare |
| `CF_ACCESS_CLIENT_SECRET` | Service Token z Cloudflare |
| `API_KEY` | opcjonalny klucz Django |

### Workflow użytkownika

1. Otwórz dokument (z fork Connectorem).
2. **Extensions → Zotero20 → Import panel** — sidebar po prawej.
3. Zakładka **Badanie 1** → wklej ORCID lub DOI → **Import**.
4. Komunikat: „Dodano N pozycji do Badanie 1”.
5. W tekście: menu **Zotero → Add Citation** — nowe pozycje są od razu na liście (bez sync delay).
6. **Zotero → Refresh** — bibliografia i numeracja jak zawsze.

---

## Diagram: co użytkownik widzi w przeglądarce

```
Google Docs
├── Pasek menu: [Plik] [Edycja] … [Zotero ▼]     ← fork Connector (cytowania)
│       ├── Add/Edit Citation
│       ├── Add/Edit Bibliography
│       ├── Preferences
│       ├── Refresh          ← działa przez tunel na serwer
│       └── Unlink Citations
│
└── Panel boczny: Zotero20 Import               ← Apps Script (tylko dodawanie źródeł)
        ├── [Badanie 1] [Badanie 2]
        ├── Import ORCID
        └── Import DOI
```

---

## Checklist „czy wszystko działa”

- [ ] Menu **Zotero** widoczne w Google Docs (bez lokalnego Zotero na PC).
- [ ] Add Citation pokazuje pozycje z biblioteki **serwerowej**.
- [ ] **Refresh** aktualizuje cytowanie po zmianie metadanych w Zotero.
- [ ] Zmiana stylu w Preferences przebudowuje bibliografię.
- [ ] Wstawienie cytowania między istniejące przesuwa numerację.
- [ ] Sidebar importuje DOI/ORCID do właściwej kolekcji.
- [ ] Po imporcie z sidebara Refresh / Add Citation widzi nową pozycję w &lt;2 s.

---

## Częste pytania

**Czy muszę coś instalować w samym Google Doc?**  
Nie dla cytowań — tylko rozszerzenie Chrome/Firefox. Sidebar wymaga add-onu lub szablonu ze skryptem.

**Czy mogę używać oficjalnego Connectora?**  
Nie — nie obsługuje zdalnego URL ani CF Access. Refresh nie połączy się z RPi.

**Czy tracę field codes / NamedRanges?**  
Nie — ten sam mechanizm co oficjalny Connector; zmieniasz tylko adres backendu.

**Czy Web API zotero.org wystarczy do Refresh?**  
Nie. Refresh i citing protocol wymagają **Zotero Desktop HTTP server** (`/connector/document/*`).
