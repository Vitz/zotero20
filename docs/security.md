# Bezpieczeństwo

## Model zagrożeń

Zotero Local API na porcie 23119 pozwala m.in. na:

- odczyt całej biblioteki,
- zapis i usuwanie pozycji,
- wykonywanie komend citing protocol (modyfikacja „logiki” cytowań w integracjach).

**Eksponowanie tego API na internet bez warstwy auth = pełny dostęp do biblioteki.**

Zotero celowo binduje tylko `127.0.0.1`. Projekt zotero20 używa reverse proxy (Cloudflare Tunnel), nie zmienia bind w Zotero.

## Warstwy ochrony

### 1. Cloudflare Access (obowiązkowe)

- Każdy hostname (`zotero.*`, `api.*`) za Access Application.
- Domyślna polityka: **deny all**, allow tylko Service Token lub konkretni użytkownicy IdP.
- Brak publicznego bypass.

### 2. Service Tokeny — rozdzielenie

| Token | Użycie | Rotacja |
|-------|--------|---------|
| `connector-token` | Fork Zotero Connector (wbudowany w build lub config) | Co 90 dni |
| `gas-token` | Google Apps Script (Script Properties) | Co 90 dni |
| `admin-token` | Ręczne curl / CI smoke tests | Po użyciu |

Nie używaj jednego tokenu wszędzie — kompromitacja GAS nie powinna wystarczyć do pełnego dostępu Connectora jeśli polityki są rozdzielone (opcjonalnie osobne Access Apps).

### 3. Django — dodatkowy API key (zalecane)

Cloudflare Access + nagłówek `X-API-Key` znany tylko GAS i adminom. Chroni przed nadużyciem jeśli token CF wycieknie z jednego kanału.

### 4. Sieć RPi

- Brak port forwarding 23119/8000 na routerze.
- SSH tylko kluczem; fail2ban opcjonalnie.
- Aktualizacje systemu: unattended-upgrades.

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
