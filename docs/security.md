# Bezpieczeństwo

## Model zagrożeń

Zotero Local API na porcie 23119 pozwala m.in. na:

- odczyt całej biblioteki,
- zapis i usuwanie pozycji,
- wykonywanie komend citing protocol (modyfikacja „logiki” cytowań w integracjach).

**Eksponowanie tego API na internet bez warstwy auth = pełny dostęp do biblioteki.**

Zotero celowo binduje tylko `127.0.0.1`. Projekt zotero20 używa reverse proxy (Cloudflare Tunnel), nie zmienia bind w Zotero.

## Warstwy ochrony

### 1. Django gateway (główna)

- Jeden publiczny punkt: `zotero.keyweb.pl` → Django `:8000`.
- Zotero (`:23119`) **nigdy** nie trafia na tunel — tylko proxy wewnętrzne.
- **X-API-Key** wymagany dla:
  - `/connector/*` (fork Connectora, cytowania Docs)
  - `/api/v1/*` (import ORCID/DOI, sidebar GAS)
  - `/api/users/*`, `/api/plus/*` (Local API przez proxy)
- **Bez klucza:** `/api/v1/health`, `/cite/<item_key>` (publiczna karta bibliograficzna: tytuł, autorzy, DOI — bez notatek i kolekcji).

### 2. Panel admin `/app/`

- Brak rejestracji publicznej — tylko `createsuperuser`.
- **Honeypot** na formularzu logowania.
- **Captcha** (`CAPTCHA_TYPE`): `none` | `simple` | `recaptcha` | `hcaptcha`.
- Klucze captcha w `.env` — patrz `server/.env.example`.

### 3. Cloudflare Access (opcjonalnie, dodatkowa warstwa)

- Można zostawić przed Django jako defense in depth.
- Bez CF Access nadal chroni **API key** — nie wystawiaj bez `ZOTERO20_API_KEY`.

### 4. Sieć RPi

- Brak port forwarding 23119/8000 na routerze (tylko tunel → 8000).
- SSH kluczem; aktualizacje systemu.

## Co NIE robić

- `extensions.zotero.httpServer.bind` na `0.0.0.0` (jeśli taka pref istnieje w fork — nie używać).
- Tunel bez Access „bo tylko ja używam”.
- Commit Service Tokenów do git — użyć `.env.example` bez wartości.
- Udostępnianie oficjalnego Connectora z `connector.url` na publiczny host — każdy z tokenem miałby dostęp.

## Dane w Google Apps Script

- `CF-Access-Client-Id`, `CF-Access-Client-Secret`, `X-API-Key` → **Script Properties**, nie w repozytorium.
- clasp push nie powinien nadpisywać properties na produkcji bez świadomej migracji.

## Audit

- Logi Django: kto (IP CF), kiedy, jaki import (ORCID, study).
- Cloudflare Access logs: odrzucone requesty.
- Okresowy przegląd Service Tokens w Zero Trust.

## Incydent — wyciek tokenu

1. Unieważnij token w Cloudflare Zero Trust.
2. Wygeneruj nowy; zaktualizuj Connector build + GAS properties.
3. Przejrzyj Access logs i logi Django pod kątem nietypowego ruchu.
4. Rozważ rotację API key Django.

## Zgodność z licencją Zotero

Fork Connectora musi respektować AGPL (udostępnienie źródeł modyfikacji). Nie dystrybuuj `.crx` publicznie bez spełnienia warunków licencji upstream.
