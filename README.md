# zotero20

Zdalny backend Zotero (RPi5 + Cloudflare Tunnel) z panelem Google Docs do importu z ORCID/DOI oraz forkowanym Zotero Connector — cytowania i bibliografia działają natywnie (citeproc), bez lokalnego PC.

## Cel projektu

Użytkownik pisze w Google Docs i ma:

1. **Panel boczny** z importem pozycji (ORCID, DOI) do wybranej kolekcji Zotero (np. zakładka „badanie 1”).
2. **Standardową integrację cytowań** Zotero w Google Docs (Add Citation, Refresh, bibliografia, zmiana stylu, numeracja) — ale silnik działa na serwerze, nie na lokalnym komputerze.

Oficjalna wtyczka Zotero w Google Docs **nie** obsługuje zdalnego serwera. Wymaga fork Connectora + tunelu do instancji Zotero Desktop na RPi5.

### Co się NIE zmienia (gwarancja funkcji)

Przenosimy **tylko storage i silnik** na serwer — **nie** przepisujemy CSL ani logiki numeracji.

| Funkcja | Status |
|---------|--------|
| Add/Edit Citation, Bibliography | bez zmian |
| **Refresh** (cytowania + metadane) | bez zmian — citing protocol na serwerze |
| Zmiana stylu, numeracja [1][2][3], ibid. | citeproc-js w Zotero Desktop na RPi |
| Szybkie dodawanie źródeł | **nowe** — sidebar ORCID/DOI → API |

Szczegóły instalacji w Docs: **[docs/google-docs-setup.md](docs/google-docs-setup.md)**  
API Zotero + Docker vs native: **[docs/zotero-api-and-docker.md](docs/zotero-api-and-docker.md)**

---

## Jak dodać do Google Docs (skrót)

1. **Fork Zotero Connector** (Chrome/Firefox, Load unpacked) — menu **Zotero** w Docs, Refresh, bibliografia. Zastępuje oficjalny Connector; `connector.url` → tunel CF.
2. **Add-on Apps Script** (sidebar) — import ORCID/DOI do kolekcji „badanie 1”. Osobny element; nie zastępuje menu Zotero.

Bez fork Connectora **nie ma** Refresh przez serwer. Bez sidebara nadal możesz cytować — ale źródła dodajesz ręcznie w Zotero na serwerze.

---

## Architektura wysokiego poziomu

```
┌─────────────────────────────────────────────────────────────────┐
│  Przeglądarka (Google Docs)                                    │
│                                                                 │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │ Sidebar GAS          │    │ Fork Zotero Connector        │  │
│  │ (ORCID, DOI,         │    │ connector.url → tunel CF       │  │
│  │  zakładki badań)     │    │ Refresh / cytowania / biblio   │  │
│  └──────────┬───────────┘    └──────────────┬───────────────┘  │
└─────────────┼───────────────────────────────┼───────────────────┘
              │ HTTPS + auth                  │ HTTPS + CF Access
              ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Tunnel (cloudflared)                                │
│  • api.zotero20.example.com  → Django (ORCID, admin)            │
│  • zotero.zotero20.example.com → localhost:23119 (Zotero API)  │
│  • Cloudflare Access (Service Token) na obu hostname'ach        │
└─────────────────────────────────────────────────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Raspberry Pi 5 (aarch64, Linux)                              │
│                                                                 │
│  ┌─────────────────┐   ┌──────────────────────────────────┐    │
│  │ Django / FastAPI │   │ Zotero 8 Desktop (headless)       │    │
│  │ ORCID → DOI      │──▶│ port 23119 (tylko localhost)    │    │
│  │ mapowanie kolekcji│   │ + wtyczka zotero-api-plus         │    │
│  └─────────────────┘   │ + sync z kontem zotero.org        │    │
│                          └──────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Dwa niezależne przepływy

| Przepływ | Odpowiedzialność | Protokół |
|----------|------------------|----------|
| **A. Import pozycji** | Sidebar GAS → API Django → Local API Zotero | REST JSON |
| **B. Cytowania w dokumencie** | Fork Connector ↔ Zotero (citing protocol) | HTTP na `/connector/document/*` |

Przepływ B **nie przechodzi przez Django** — Connector rozmawia bezpośrednio z Zotero przez tunel (proxy 1:1 na port 23119).

---

## Komponenty repozytorium

```
zotero20/
├── README.md                 # ten plik
├── docs/
│   ├── architecture.md           # szczegóły techniczne
│   ├── google-docs-setup.md      # jak podłączyć Docs (Connector + sidebar)
│   ├── zotero-api-and-docker.md  # warstwy API, Docker vs native RPi
│   ├── security.md               # CF Access, tokeny, zagrożenia
│   └── deployment-rpi5.md        # instalacja krok po kroku na RPi
├── server/
│   ├── docker-compose.yml.example  # opcjonalnie x86 VPS; RPi → native
│   ├── cloudflared/          # config tunelu
│   └── django/               # mikroserwis ORCID + mapowanie kolekcji
│       ├── manage.py
│       ├── zotero20/
│       └── apps/
│           └── imports/      # ORCID, DOI, kolekcje
├── connector/                # fork zotero-connectors
│   └── patches/              # connector.url + nagłówki CF Access
├── google-docs/
│   └── sidebar/              # Apps Script (clasp): panel ORCID + zakładki
└── scripts/
    ├── setup-rpi.sh
    └── test-zotero-api.sh
```

---

## Faza 0 — Przygotowanie infrastruktury

### 0.1 Sprzęt i OS

- **RPi5**, 8 GB RAM zalecane (Zotero + Firefox engine).
- **OS:** Raspberry Pi OS 64-bit (Bookworm) lub Debian arm64.
- Stały adres w LAN; RPi podłączone do UPS (opcjonalnie).

### 0.2 Domena i Cloudflare

- [ ] Domena w Cloudflare (np. `zotero20.example.com`).
- [ ] Dwa hostname'y w tunelu:
  - `zotero.zotero20.example.com` → `http://127.0.0.1:23119`
  - `api.zotero20.example.com` → `http://127.0.0.1:8000`
- [ ] **Cloudflare Access** — Application dla obu hostów.
- [ ] **Service Token** (Client ID + Client Secret) — do Connectora i GAS.
- [ ] Zero Trust: polityka „Service Auth” only (brak publicznego dostępu bez tokenu).

### 0.3 Konto Zotero

- [ ] Konto zotero.org (sync biblioteki — backup i opcjonalny dostęp z innych urządzeń).
- [ ] Utworzenie kolekcji: `Badanie 1`, `Badanie 2`, … — zapis `collectionKey` każdej.

---

## Faza 1 — Zotero na RPi5 (backend cytowań)

### 1.1 Instalacja Zotero 8 arm64

```bash
# Pobierz oficjalny tarball linux-arm64 z zotero.org
# Rozpakuj do /opt/zotero, skrót systemd user service
```

**Wymagane preferencje** (`about:config` w Zotero lub `prefs.js`):

| Pref | Wartość |
|------|---------|
| `extensions.zotero.httpServer.enabled` | `true` |
| `extensions.zotero.httpServer.port` | `23119` |
| Local API enabled | Settings → Advanced → „Allow other applications…” |

Zotero **musi** nasłuchiwać tylko na `127.0.0.1` (domyślne — nie zmieniać bind na `0.0.0.0`).

### 1.2 Headless / bez monitora

Opcje (wybrać jedną):

1. **Natywna instalacja + systemd user service** — Zotero 8 arm64 uruchomione przy logowaniu użytkownika `zotero`; ewentualnie `xvfb-run` jeśli wymaga display.
2. **Docker + Xvfb** — kontener z Zotero (trudniejsze na ARM, większe zużycie RAM).

Rekomendacja: **natywna instalacja arm64** + `systemd --user` unit z `Restart=always`.

### 1.3 Wtyczka zotero-api-plus

- [ ] Zainstaluj [zotero-api-plus](https://github.com/GOKORURI007/zotero-api-plus) (XPI).
- [ ] Zweryfikuj endpointy:

```bash
curl -s http://127.0.0.1:23119/api/plus/health
curl -X POST http://127.0.0.1:23119/api/plus/add-item-by-id \
  -H "Content-Type: application/json" \
  -d '{"identifier":"10.1038/nature12373","collectionKey":"TWOJ_KEY"}'
```

### 1.4 cloudflared na RPi

```yaml
# server/cloudflared/config.yml (szkic)
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: zotero.zotero20.example.com
    service: http://127.0.0.1:23119
  - hostname: api.zotero20.example.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```

- [ ] Test z zewnątrz z Service Token:

```bash
curl -H "CF-Access-Client-Id: $CF_ID" \
     -H "CF-Access-Client-Secret: $CF_SECRET" \
     https://zotero.zotero20.example.com/connector/ping
```

Oczekiwany wynik: odpowiedź Zotero Connector ping (np. `{"success":true}`).

### 1.5 Kryteria akceptacji Fazy 1

- [ ] Zotero działa po restarcie RPi (systemd).
- [ ] `add-item-by-id` dodaje pozycję do właściwej kolekcji lokalnie.
- [ ] Tunel CF odpowiada na `/connector/ping` z tokenem.
- [ ] Bez tokenu — `403` od Cloudflare Access.

---

## Faza 2 — Fork Zotero Connector

### 2.1 Repozytorium źródłowe

- Fork: [zotero/zotero-connectors](https://github.com/zotero/zotero-connectors) (Chrome branch).
- Submodule lub kopia w `connector/`.

### 2.2 Zmiany w kodzie

| Plik / obszar | Zmiana |
|---------------|--------|
| Config editor default | `connector.url` = `https://zotero.zotero20.example.com` |
| Warstwa HTTP (messaging / fetch) | Do każdego requestu do Zotero: nagłówki `CF-Access-Client-Id`, `CF-Access-Client-Secret` |
| Branding | Nazwa wtyczki np. „Zotero20 Connector” (żeby nie kolidować z oficjalną) |

**Nie zmieniać** logiki Google Docs integration — tylko bazowy URL i auth.

Ukryta pref w oficjalnym Connectorze: `connector.url` — u nas hardcoded lub w Options z pola tekstowego (dla dev).

### 2.3 Build i dystrybucja

```bash
cd connector
npm install
npm run build
# Załaduj unpacked extension w Chrome (chrome://extensions)
```

- [ ] Dystrybucja: `.crx` lub instrukcja „Load unpacked” dla współautorów.
- [ ] Dokumentacja: każdy współautor Docs **musi** mieć ten Connector.

### 2.4 Test integracji Google Docs

1. Otwórz dokument Google Docs z zainstalowanym fork Connectorem.
2. Zotero → Add Citation — wybierz pozycję z biblioteki serwerowej.
3. Refresh — numeracja i bibliografia aktualizują się.
4. Zmiana stylu (Document Preferences) — działa.
5. Test na dużym dokumencie (50+ stron) — wydajność przez tunel.

### 2.5 Kryteria akceptacji Fazy 2

- [ ] Cytowania bez lokalnego Zotero na PC.
- [ ] Refresh po `add-item-by-id` widzi nową pozycję natychmiast (bez sync delay).
- [ ] Współautor z fork Connectorem może edytować bez „unlinking” (wszyscy muszą mieć fork).

---

## Faza 3 — API Django (ORCID + mapowanie badań)

### 3.1 Zakres

Mikroserwis **nie** generuje cytowań — tylko importuje metadane do Zotero.

Endpointy (propozycja):

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `POST` | `/api/v1/import/doi` | `{ "doi": "...", "study": "badanie-1" }` |
| `POST` | `/api/v1/import/orcid` | `{ "orcid": "0000-0002-...", "study": "badanie-1", "limit": 50 }` |
| `GET` | `/api/v1/studies` | Lista mapowań `study_slug → collectionKey` |
| `GET` | `/api/v1/health` | Healthcheck |

Auth: ten sam Cloudflare Access **lub** osobny API key w nagłówku `X-API-Key` (dodatkowa warstwa w Django).

### 3.2 Przepływ ORCID

```
ORCID ID
  → GET https://pub.orcid.org/v3.0/{orcid}/works
  → dla każdej pracy: external-id (DOI, PMID, arXiv)
  → jeśli DOI: POST localhost:23119/api/plus/add-item-by-id
  → jeśli brak DOI: zapis do raportu „skipped” (JSON w odpowiedzi)
  → collectionKey z mapowania study_slug
```

**Uwaga:** ORCID nie jest identyfikatorem Zotero — zawsze rozwiązuj do DOI/PMID.

### 3.3 Mapowanie „badanie 1” → kolekcja

Plik konfiguracyjny `server/django/config/studies.yaml`:

```yaml
studies:
  badanie-1:
    label: "Badanie 1"
    collection_key: "ABC123XYZ"
  badanie-2:
    label: "Badanie 2"
    collection_key: "DEF456UVW"
```

Klucze kolekcji pobierz raz:

```bash
curl http://127.0.0.1:23119/api/users/0/collections
```

### 3.4 Kryteria akceptacji Fazy 3

- [ ] Import DOI przez API trafia do właściwej kolekcji.
- [ ] Import ORCID zwraca raport: `added`, `skipped`, `errors`.
- [ ] Rate limiting na endpoint ORCID (unikaj blokady przez ORCID API).
- [ ] Logi importów (opcjonalnie SQLite/Postgres na RPi).

---

## Faza 4 — Panel Google Docs (Apps Script)

### 4.1 UI sidebaru

Zakładki:

- **Import DOI** — pole tekstowe + wybór badania (dropdown).
- **Import ORCID** — pole ORCID + wybór badania + przycisk „Importuj prace”.
- **Status** — ostatni import, liczba dodanych pozycji, błędy.

### 4.2 Komunikacja

```javascript
// Apps Script → Django przez UrlFetchApp
const response = UrlFetchApp.fetch('https://api.zotero20.example.com/api/v1/import/doi', {
  method: 'post',
  contentType: 'application/json',
  headers: {
    'CF-Access-Client-Id': PropertiesService.getScriptProperties().getProperty('CF_ID'),
    'CF-Access-Client-Secret': PropertiesService.getScriptProperties().getProperty('CF_SECRET'),
  },
  payload: JSON.stringify({ doi: doi, study: 'badanie-1' }),
});
```

Secrets w **Script Properties** (nie w kodzie źródłowym).

### 4.3 Deployment

- [ ] clasp: `google-docs/sidebar/`
- [ ] Publish jako Add-on (test) lub bound script do szablonu dokumentu.
- [ ] Menu: Extensions → Zotero20 → Open Panel.

### 4.4 Workflow użytkownika (docelowy)

1. Otwórz dokument Google Docs (z fork Connectorem).
2. Sidebar → zakładka „Badanie 1” → wklej ORCID → Import.
3. Poczekaj na potwierdzenie (np. „Dodano 12/15 prac”).
4. W tekście: Zotero → Add Citation → wybierz nową pozycję.
5. Refresh — bibliografia na końcu dokumentu.

### 4.5 Kryteria akceptacji Fazy 4

- [ ] Sidebar działa bez lokalnego Zotero.
- [ ] Import DOI i ORCID do właściwej kolekcji.
- [ ] Komunikaty błędów czytelne dla użytkownika (PL).

---

## Faza 5 — Bezpieczeństwo i utrzymanie

### 5.1 Zagrożenia

| Zagrożenie | Mitygacja |
|------------|-----------|
| Publiczny dostęp do Local API | CF Access + tylko localhost bind |
| Kradzież Service Token | Rotacja tokenów; osobne tokeny Connector vs GAS |
| RPi offline | Monitoring (Uptime Kuma); alert email/Telegram |
| Nieautoryzowany import do biblioteki | API key w Django + whitelist użytkowników Google (opcjonalnie) |

### 5.2 Backup

- Sync zotero.org (domyślny backup biblioteki).
- Kopia `~/Zotero` (profil) — cron rsync.
- Eksport kolekcji okresowo (CSL JSON).

### 5.3 Monitoring

- [ ] Healthcheck co 5 min: `/connector/ping` + `/api/v1/health`.
- [ ] Logrotate dla Zotero i Django.
- [ ] Aktualizacje Zotero 8 — test na staging przed prod.

---

## Harmonogram (szacunek)

| Faza | Zakres | Czas |
|------|--------|------|
| 0 | Domena, CF, RPi OS | 1–2 dni |
| 1 | Zotero + api-plus + tunel | 2–3 dni |
| 2 | Fork Connector + test Docs | 3–5 dni |
| 3 | Django ORCID/DOI | 3–4 dni |
| 4 | Sidebar GAS | 2–3 dni |
| 5 | Security, backup, docs | 1–2 dni |
| **Razem** | MVP | **~2–3 tygodnie** |

---

## Decyzje architektoniczne (ADR skrót)

1. **Zotero Desktop na serwerze, nie Web API** — citing protocol (`/connector/document/*`) daje Refresh i bibliografię; Web API tego nie ma.
2. **Django tylko do importu** — cytowania nie przechodzą przez Django (latency, złożoność).
3. **Fork Connectora konieczny** (AGPL, `npm run build`) — oficjalny nie wspiera zdalnego URL + CF Access headers.
4. **RPi5 natywnie arm64** — Docker możliwy na x86, na RPi rekomendujemy native; Zotero 8 ma oficjalny build arm64.
5. **Local API + zotero-api-plus** — szybki import DOI; ORCID przez Django → DOI → `add-item-by-id`.
6. **Kolekcje = zakładki badań** — proste mapowanie `study_slug → collectionKey`.

---

## Co świadomie NIE robimy

- Własny silnik CSL (citeproc-py) — zbędny przy serwerowym Zotero.
- Import przez Zotero Web API + sync — wprowadza opóźnienie przed Refresh.
- Wystawianie portu 23119 bez auth na publiczny internet.
- Zastępowanie Connectora w Google Docs własnym skryptem do cytowań — to miesiące pracy (numeracja, field codes, NamedRanges).

---

## Następne kroki (implementacja w repo)

1. [ ] `docs/deployment-rpi5.md` — skrypt instalacji krok po kroku.
2. [ ] `server/cloudflared/config.yml.example`
3. [ ] `connector/patches/` — diff na zotero-connectors.
4. [ ] `server/django/` — szkielet projektu z endpointem `/import/doi`.
5. [ ] `google-docs/sidebar/` — clasp + minimalny HTML panelu.
6. [ ] `scripts/test-zotero-api.sh` — smoke test po deployu.

---

## Linki

- [Zotero Local API](https://www.zotero.org/support/dev/web_api/v3/local_api)
- [HTTP Citing Protocol](https://www.zotero.org/support/dev/client_coding/http_integration_protocol)
- [Zotero Google Docs Integration](https://github.com/zotero/zotero-google-docs-integration)
- [zotero-api-plus](https://github.com/GOKORURI007/zotero-api-plus)
- [ORCID Public API](https://pub.orcid.org/v3.0/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

---

## Licencja

Komponenty Zotero — AGPL. Fork Connectora: zgodnie z licencją upstream. Kod własny (Django, GAS, skrypty) — do ustalenia (MIT/AGPL).
