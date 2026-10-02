# Zotero20 — prywatny add-on Google Docs (Editor Add-on)

Panel to klasyczny **Editor Add-on** (menu + HTML sidebar), nie CardService Workspace Add-on.
Dzięki temu ten sam kod działa w wielu dokumentach po jednej instalacji.

## Wymagania

| | |
|--|--|
| Konto | **Google Workspace** (domena uczelni/firmy) — prywatny Marketplace |
| Albo bez Workspace | **Test as add-on** — do ~100 testerów (wystarczy na zespół) |
| Skrypt | ten w `google-docs/sidebar` (`clasp push`) |
| Serwer | `https://zotero.keyweb.pl` + `ZOTERO20_API_KEY` w Script Properties |

Bez Workspace nie opublikujesz „Private” w Marketplace — użyj ścieżki **Test** (sekcja B).

---

## A. Przygotowanie projektu (już w repo)

Kod ma:

- `onOpen` + **`onInstall`** (wymagane przy instalacji add-onu)
- `appsscript.json` z OAuth scopes (Docs, UI, UrlFetch)

Po zmianach:

```powershell
cd google-docs\sidebar
clasp push
clasp version "Zotero20 Editor Add-on 2.2.6"
```

Script Properties (Apps Script → Ustawienia projektu → Właściwości skryptu):

| Klucz | Wartość |
|-------|---------|
| `ZOTERO20_API_KEY` | klucz API serwera |
| `ZOTERO20_GEMINI_API_KEY` | opcjonalnie (albo z panelu Ustawienia) |

---

## B. Szybka dystrybucja dla zespołu (Test as add-on)

Bez Marketplace — najszybsza ścieżka na kilka osób:

1. Otwórz projekt: `clasp open` albo [script.google.com](https://script.google.com)
2. **Wdróż → Testuj wdrożenia** (Deploy → Test deployments)
3. Typ: **Add-on**
4. Dokument: wybierz Docs albo „Nowy dokument”
5. **Zainstaluj** / Execute as: User accessing the web app
6. Udostępnij projekt Apps Script współpracownikom (**Udostępnij** → edytorzy/testerzy)
7. Oni: ten sam Deploy → Test deployments → Install w swoim Docs

Albo: **Wdróż → Nowe wdrożenie → Typ: Add-on** → wersja z `clasp version` → skopiuj link instalacji (jeśli dostępny w konsoli).

W dokumencie: menu **Zotero20 → Otwórz panel importu**.

---

## C. Prywatny add-on w Google Workspace Marketplace

Dla całej domeny (wszyscy użytkownicy Workspace widzą Zotero20 w Docs):

### 1. Google Cloud Project

1. [console.cloud.google.com](https://console.cloud.google.com) → nowy projekt np. `zotero20-addon`
2. Apps Script → **Ustawienia projektu** → odznacz „Projekt GCP domyślny Google” → wklej **numer projektu** GCP
3. W GCP włącz API: Google Docs API, Google Drive API, Apps Script API (wg kreatora Marketplace)

### 2. Ekran zgody OAuth

1. GCP → **APIs & Services → OAuth consent screen**
2. User type: **Internal** (tylko Twoja organizacja Workspace) — to jest „prywatny”
3. App name: `Zotero20`
4. Scopes jak w `appsscript.json`
5. Zapisz

### 3. Wdrożenie wersji w Apps Script

```powershell
clasp push
clasp version "release-2.2.6"
```

Albo w UI: **Wdróż → Nowe wdrożenie → Typ: Complementary / Add-on** (Editor).

### 4. Listing Marketplace

1. [Google Workspace Marketplace SDK](https://console.cloud.google.com/apis/library/marketplace-sdk) → Enable
2. **API & Services → Google Workspace Marketplace SDK → App Configuration**
3. Uzupełnij:
   - App name, description, icon 128×128 (PNG)
   - App type: **Editor add-on**
   - Docs: włącz
   - Deployment ID z Apps Script
4. **Store Listing**: visibility **Private** (tylko Twoja domena)
5. Submit / Publish (Internal nie wymaga recenzji Google jak publiczne)

### 5. Admin Workspace (opcjonalnie)

Admin console → Apps → Google Workspace Marketplace apps → **Domain install** Zotero20  
→ wszyscy w domenie mają add-on w Docs bez ręcznej instalacji.

---

## Co zobaczy użytkownik

1. Otwiera dowolny Google Docs (w domenie / z zainstalowanym add-onem)
2. Menu **Zotero20 → Otwórz panel importu**
3. Raz: zezwolenie OAuth
4. Ustawienia: kolekcja dokumentu (+ klucz Gemini jeśli potrzeba)
5. Import / cytowania jak dotychczas — serwer ten sam

Klucz `ZOTERO20_API_KEY` jest w **projekcie add-onu** (Script Properties), wspólny dla wszystkich Docs.  
Kolekcja i styl zostają **per dokument**.

---

## Aktualizacje

```powershell
cd google-docs\sidebar
# edytuj Code.gs / Sidebar.html
clasp push
clasp version "2.2.7 fix …"
```

Potem w Deployments wybierz nową wersję jako aktywne wdrożenie add-onu  
(albo Marketplace → zaktualizuj Deployment ID / wersję).

Testerzy z „Test deployments” czasem muszą odświeżyć / przeinstalować test.

---

## Checklist

- [ ] `onInstall` + scopes w `appsscript.json`
- [ ] `clasp push` + `clasp version`
- [ ] Script Properties: `ZOTERO20_API_KEY`
- [ ] Ścieżka B (test) **albo** C (Marketplace Internal)
- [ ] Smoke: 2 różne Docs → menu Zotero20 w obu
- [ ] Import DOI w obu (różne kolekcje dokumentów OK)

## Uwagi

- **Consumer Gmail** — tylko Test as add-on / bound script, nie prywatny Marketplace Internal.
- Add-on ≠ serwer Zotero — nadal potrzebny VPS/`zotero.keyweb.pl`.
- Ikona i listing Marketplace — przygotuj proste PNG 128×128 z napisem „Z20”.
