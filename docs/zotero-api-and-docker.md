# API Zotero w projekcie zotero20

Projekt opiera się na **oficjalnych, udokumentowanych API Zotero** — nie na reverse-engineeringu bazy SQLite. Poniżej mapowanie: które API za co odpowiada i dlaczego to gwarantuje Refresh + bibliografię.

## Warstwy API (wszystkie uwzględnione w planie)

```
┌─────────────────────────────────────────────────────────────────┐
│  Google Docs + Fork Connector                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
 Connector HTTP          Citing Protocol        Local REST API
 /connector/ping         /connector/document/   /api/users/0/...
 /connector/saveItems    execCommand            /api/plus/add-item-by-id
                         /connector/document/   (zotero-api-plus)
                         respond
     │                       │                       │
     └───────────────────────┴───────────────────────┘
                             │
                    Zotero Desktop :23119
                    (ten sam proces na serwerze)
```

### 1. Connector HTTP Server (port 23119)

Dokumentacja: [Connector HTTP Server](https://www.zotero.org/support/dev/client_coding/connector_http_server)

- Ping, zapisywanie z www, wybór tłumaczy.
- Google Docs integration używa tego samego serwera co przeglądarka.

**W zotero20:** tunel CF proxy 1:1 na `127.0.0.1:23119` — bez modyfikacji endpointów po stronie Zotero.

### 2. HTTP Citing Protocol (klucz do Refresh i bibliografii)

Dokumentacja: [HTTP Citing Protocol](https://www.zotero.org/support/dev/client_coding/http_integration_protocol)

| Endpoint | Rola |
|----------|------|
| `POST /connector/document/execCommand` | Start transakcji (add citation, refresh, …) |
| `POST /connector/document/respond` | Wyniki komend, pętla aż `Document.complete` |

Komendy używane przez Google Docs:

- `addEditCitation`, `addEditBibliography`
- **`refresh`** — odświeżenie wszystkich pól i bibliografii
- `setDocPrefs` — zmiana stylu CSL
- `removeCodes`, `exportDocument`

**To jest serce Refresh** — citeproc-js działa w procesie Zotero Desktop, Connector tylko przenosi JSON przez tunel.

**W zotero20:** fork Connectora zmienia **wyłącznie URL** docelowy; protokół bez zmian.

### 3. Zotero Local API (`/api/`)

Dokumentacja: [Local API v3](https://www.zotero.org/support/dev/web_api/v3/local_api)

- Odczyt/zapis biblioteki, kolekcje, tagi.
- W Zotero 10+: `Zotero-Server-ID`, lokalne klucze API (`POST /api/local/authorize`).
- Wymaga włączenia: *Allow other applications on this computer to communicate with Zotero*.

**W zotero20:**

- Django i skrypty na RPi wołają `http://127.0.0.1:23119/api/...` **lokalnie** (bez tunelu).
- Pobieranie `collectionKey` dla mapowania „badanie 1”.
- Opcjonalnie: odczyt listy pozycji w panelu admin.

### 4. zotero-api-plus (wtyczka — rozszerzenie Local API)

Repozytorium: [GOKORURI007/zotero-api-plus](https://github.com/GOKORURI007/zotero-api-plus)

| Endpoint | Rola w zotero20 |
|----------|-----------------|
| `GET /api/plus/health` | smoke test |
| `POST /api/plus/add-item-by-id` | szybki import DOI/ISBN/PMID do kolekcji |

To **nie zastępuje** citing protocol — tylko przyspiesza dodawanie źródeł (ścieżka A: sidebar → Django → ten endpoint).

### 5. Zotero Web API (zotero.org) — pomocniczo

Dokumentacja: [Web API v3](https://www.zotero.org/support/dev/web_api/v3/start)

| Użycie | W zotero20 |
|--------|------------|
| Sync biblioteki Desktop ↔ chmura | **tak** — backup, drugi komputer |
| Bezpośrednie cytowania w Google Docs | **nie** — brak citing protocol |
| Import DOI zamiast Local API | **nie** — opóźnienie sync przed Refresh |

Sync z kontem zotero.org jest **opcjonalnym backupem**, nie ścieżką krytyczną dla Docs.

### 6. ORCID Public API — poza Zotero

- `GET https://pub.orcid.org/v3.0/{orcid}/works`
- Django mapuje prace → DOI → `add-item-by-id`

---

## Dlaczego nie tracimy Refresh przy „wyniesieniu storage”

| Co przenosisz | Co zostaje takie samo |
|---------------|------------------------|
| Plik `zotero.sqlite` + `storage/` na RPi | Protokół Connector ↔ Zotero |
| Proces citeproc na serwerze | Field codes w Google Docs |
| Miejsce dodawania pozycji (API zamiast ręcznie) | Menu Zotero, komenda Refresh |

**Storage na zewnątrz** = baza i PDF-y na RPi (lub wolumen Dockera). **Logika cytowań** = nadal ten sam kod Zotero co lokalnie — tylko adres IP inny.

---

## Zotero na Linuxie w Dockerze — czy działa dobrze?

### Krótka odpowiedź

| Scenariusz | Rekomendacja |
|------------|--------------|
| **RPi5 (arm64)** | **Natywna instalacja** Zotero 8 arm64 + systemd + opcjonalnie Xvfb |
| **Serwer x86_64 / VPS** | Docker **możliwy**, ale z Xvfb/VNC; więcej RAM i debugowania |
| **Produkcja z Google Docs Refresh** | Priorytet: **stabilny, zawsze włączony** proces Zotero — native zwykle prostsze na RPi |

### Dlaczego Docker jest trudniejszy dla Zotero

Zotero Desktop to aplikacja **GUI na silniku Firefox/XUL**, nie serwer headless:

1. Wymaga display (Xvfb lub VNC) nawet „w tle”.
2. Profil użytkownika (`~/Zotero`) — wolumen musi być trwały (baza + `storage/`).
3. Wtyczki XPI (`zotero-api-plus`) — instalacja w profilu w kontenerze.
4. Na **ARM** (RPi5) obrazy Docker ze Zotero są rzadkie; oficjalny build to tarball arm64, nie obraz.
5. Zużycie RAM: Zotero + Xvfb ≈ 500 MB–1.5 GB — na RPi 4 GB może być ciasno.

### Kiedy Docker ma sens

- VPS x86_64 z 4+ GB RAM i zespół zna Docker.
- Chcesz jeden `docker compose up` z: `zotero` + `cloudflared` + `django`.
- Gotowość na utrzymanie własnego Dockerfile (community images bywają nieaktualne).

### Plan w repo

- **Faza 1 domyślnie:** native na RPi5 (`docs/deployment-rpi5.md`).
- **Faza 1b (opcjonalnie):** `server/docker-compose.yml` — dokumentujemy jako eksperyment, nie jako główną ścieżkę na RPi.

### Szkic docker-compose (x86_64 — referencja)

```yaml
# server/docker-compose.yml.example — NIE testowane na RPi; wymaga własnego obrazu + Xvfb
services:
  zotero:
    image: # własny build lub community — do uzupełnienia w Fazie 1b
    volumes:
      - zotero-data:/home/zotero/Zotero
    environment:
      - DISPLAY=:99
    # ports NIE wystawiaj na 0.0.0.0 — tylko cloudflared w tej samej sieci docker

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    volumes:
      - ./cloudflared:/etc/cloudflared

volumes:
  zotero-data:
```

**Bezpieczeństwo:** port `23119` tylko w sieci wewnętrznej Docker / localhost — nigdy `ports: "23119:23119"` na host publiczny.

---

## Co forkujemy / przekompilowujemy (open source)

| Projekt | Licencja | Modyfikacja | Build |
|---------|----------|-------------|-------|
| [zotero-connectors](https://github.com/zotero/zotero-connectors) | AGPL | URL + CF headers | `npm run build` |
| [zotero-api-plus](https://github.com/GOKORURI007/zotero-api-plus) | — | ewent. własne endpointy ORCID | XPI / fork JS |
| Zotero Desktop | AGPL | **nie** — oficjalny arm64 binary | — |
| zotero20 Django + GAS | własny | nowy kod | pip / clasp |

**Nie forkujemy** citeproc ani logiki Google Docs field codes — to pozostaje w upstream Zotero.

---

## Podsumowanie decyzji API

1. **Refresh i bibliografia** → Citing Protocol na Zotero Desktop (przez tunel).
2. **Szybkie dodawanie źródeł** → Local API + zotero-api-plus (+ Django dla ORCID).
3. **Backup / sync** → Web API przez wbudowany sync Zotero (opcjonalnie).
4. **Docker** → możliwy na x86; na RPi5 rekomendujemy native; plan uwzględnia obie ścieżki.
