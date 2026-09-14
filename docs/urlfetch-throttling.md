# Throttling UrlFetch (Google Apps Script)

Błąd **„Usługa wywołana zbyt wiele razy jednego dnia: urlfetch”** = wyczerpany dzienny limit Google, nie awaria Zotero.

Oficjalne Zotero w Docs woła Apps Script (UrlFetch) przy każdej operacji na dokumencie. Przy limicie trzeba **zwolnić** wywołania — dziś ręcznie, w fork Connectora / sidebara — w kodzie.

## Natychmiast (dzisiaj)

1. **Zamknij** wszystkie karty Google Docs z wtyczką Zotero, których nie edytujesz.
2. W dokumencie: **Zotero → Document Preferences** → wyłącz **Automatically update citations**.
3. **Nie klikaj** Refresh / Add Citation / ponownego „sprawdzenia”, dopóki limit się nie zresetuje (~24 h).
4. Pracuj w Word/LibreOffice albo lokalnie w Zotero, jeśli musisz cytować dziś.
5. Jeśli masz Google Workspace — limity UrlFetch są wyższe (~100k vs ~20k na Gmail).

„Ostatnie sprawdzenie: …” w dialogu oznacza, że Connector **ponawia** kontakt z backendem Docs. Każda ponowna próba przy wyczerpanym limicie tylko marnuje kolejne wywołania albo nic nie zmienia do resetu.

## Co pali UrlFetch (kolejność wpływu)

| Akcja | Koszt |
|-------|--------|
| Pełny **Refresh** dużego dokumentu | bardzo wysoki (wiele wywołań Apps Script) |
| Auto-update cytowań włączone | wysoki przy każdej edycji |
| Add/Edit Citation w dużym dokumencie | średni–wysoki |
| Ciągłe otwarte Docs + retry statusu | średni (sumuje się w ciągu dnia) |
| Sidebar ORCID z pollingiem co N s | **zakazany** w zotero20 |
| Connector → lokalne/zdalne Zotero (`23119`) | **0 UrlFetch** (to HTTP z przeglądarki) |

Tunel RPi **nie** zużywa UrlFetch. Zużywa go ścieżka **Docs ↔ Apps Script Google**.

## Reguły w zotero20 (obowiązkowe przy implementacji)

### Fork Connector

- Przy błędzie UrlFetch / quota: **stop retry** na min. **1 godzinę** (backoff), nie co kilka sekund.
- Status „Ostatnie sprawdzenie” — max **1× / 5 min** przy błędzie; przy sukcesie tylko na żądanie użytkownika.
- Preferuj **Google Docs integration v2** (Docs API), jeśli stabilne — mniej Apps Script.
- Domyślnie: auto-update cytowań **wyłączone** w Document Preferences (dokumentacja UX).

### Sidebar GAS (ORCID / DOI)

```
NIE: setInterval / trigger co 30–60 s sprawdzający health
NIE: UrlFetch przy każdym otwarciu sidebara „na zapas”
TAK: UrlFetch tylko po kliknięciu „Import”
TAK: jeden batch ORCID → jeden request do Django (Django robi resztę lokalnie na RPi)
TAK: CacheService na listę studies (TTL 1 h)
```

### Monitoring na RPi

Healthcheck `/connector/ping` i `/api/v1/health` robi **cron na serwerze** albo Uptime Kuma — **nigdy** z Apps Script.

## Docelowe limity soft (cel projektowy)

| Operacja | Max na użytkownika / dzień (zalecenie) |
|----------|----------------------------------------|
| Import DOI/ORCID (sidebar) | ≤ 50 requestów GAS |
| Refresh Docs | ręcznie, świadomie; unikać przy >200 cytowaniach bez potrzeby |
| Auto-poll status Zotero z GAS | **0** |

## Checklist przed kolejną sesją pisania

- [ ] Auto-update cytowań wyłączone
- [ ] Jedna karta Docs z aktywnym Zotero
- [ ] Zotero Desktop / serwer działa **zanim** otworzysz Docs (mniej retry)
- [ ] Quota zresetowana (po błędzie urlfetch — czekaj do następnego dnia)
