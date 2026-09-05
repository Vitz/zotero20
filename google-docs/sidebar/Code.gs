/**
 * Zotero20 — panel importu ORCID/DOI (jeden host + klucz API)
 * Base: https://zotero.keyweb.pl
 */

const API_BASE = 'https://zotero.keyweb.pl/api/v1';
// Podbij przy każdej zmianie Code.gs — sidebar porównuje wersje i ostrzega przy niezgodności.
const ADDON_VERSION = '2.2.1';
const PROP_DEFAULT_COLLECTION_KEY = 'ZOTERO20_DEFAULT_COLLECTION_KEY';
const PROP_DEFAULT_COLLECTION_NAME = 'ZOTERO20_DEFAULT_COLLECTION_NAME';
const PROP_BIBLIOGRAPHY_STYLE = 'ZOTERO20_BIBLIOGRAPHY_STYLE';
const PROP_BIBLIOGRAPHY_CITED_ONLY = 'ZOTERO20_BIBLIOGRAPHY_CITED_ONLY';
const PROP_BIBLIOGRAPHY_FONT = 'ZOTERO20_BIBLIOGRAPHY_FONT';
const PROP_BIBLIOGRAPHY_FONT_SIZE = 'ZOTERO20_BIBLIOGRAPHY_FONT_SIZE';
const PROP_CITATION_INSERT_MODE = 'ZOTERO20_CITATION_INSERT_MODE';
const PROP_CITATION_LOCALE = 'ZOTERO20_CITATION_LOCALE';
const PROP_DEBUG = 'ZOTERO20_DEBUG';
const PROP_GEMINI_API_KEY = 'ZOTERO20_GEMINI_API_KEY';
const NAMED_RANGE_BIBLIOGRAPHY = 'ZOTERO20_BIBLIOGRAPHY';
const BIBLIOGRAPHY_HEADING = 'Bibliografia';
const BIBLIOGRAPHY_ALLOWED_FONTS = {
  Arial: true,
  'Times New Roman': true,
  Calibri: true,
  Georgia: true,
};
const BIBLIOGRAPHY_ALLOWED_FONT_SIZES = { 9: true, 10: true, 11: true, 12: true, 14: true };

/**
 * Kotwica cytowania = ukryty link na tekście cytowania.
 * W przeciwieństwie do NamedRange link przeżywa kopiuj/wklej, cofnięcie zmian,
 * zamknięcie dokumentu i zrobienie kopii pliku — to najbliższy odpowiednik
 * pól Zotero, jaki daje Apps Script.
 *
 * Google Docs na hover pokazuje wyłącznie URL (brak API na własny tooltip).
 * Parametr t= niesie krótki tytuł (autor+rok albo skrócony tytuł pracy),
 * żeby dało się go odczytać z dymka. Klik otwiera /cite/<ITEMKEY> (metadane).
 * Skaner (parseCitationUrl_) czyta tylko ścieżkę /cite/<ITEMKEY> i parametr c=.
 */
const CITE_LINK_BASE = 'https://zotero.keyweb.pl/cite/';

// Stara ścieżka (NamedRange + rejestr w DocumentProperties) — tylko do jednorazowej migracji.
const NAMED_RANGE_CITE_PREFIX = 'ZOTERO20_CITE_';
const PROP_CITATION_RANGES = 'ZOTERO20_CITATION_RANGES';
const PROP_LEGACY_MIGRATED = 'ZOTERO20_LEGACY_RANGES_MIGRATED';

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Zotero20')
    .addItem('Otwórz panel importu', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Zotero20 Import')
    .setWidth(320);
  DocumentApp.getUi().showSidebar(html);
}

function getCollections() {
  return apiGet('/collections');
}

/** Tworzy nową kolekcję w bibliotece Zotero (Web lub Local API przez serwer). */
function createCollection(name) {
  name = String(name || '').trim();
  if (!name) {
    throw new Error('Podaj nazwę nowej kolekcji.');
  }
  var data = apiPost('/collections', { name: name });
  if (!data || !data.key) {
    throw new Error('Serwer nie zwrócił klucza nowej kolekcji.');
  }
  return { key: data.key, name: data.name || name, source: data.source || '' };
}

function getStudies() {
  return apiGet('/studies');
}

/** Kolekcja importu jest przypisana do dokumentu — każdy Google Doc może mieć inną. */
function getDefaultCollection() {
  var docProps = PropertiesService.getDocumentProperties();
  var key = docProps.getProperty(PROP_DEFAULT_COLLECTION_KEY);
  var name = docProps.getProperty(PROP_DEFAULT_COLLECTION_NAME);
  if (key) {
    return { key: key, name: name || key };
  }
  // Wcześniej kolekcja była globalna (ScriptProperties) i „przeciekała” między dokumentami.
  var legacyKey = PropertiesService.getScriptProperties().getProperty(PROP_DEFAULT_COLLECTION_KEY);
  var legacyName = PropertiesService.getScriptProperties().getProperty(PROP_DEFAULT_COLLECTION_NAME);
  if (legacyKey) {
    docProps.setProperty(PROP_DEFAULT_COLLECTION_KEY, legacyKey);
    docProps.setProperty(PROP_DEFAULT_COLLECTION_NAME, legacyName || legacyKey);
    return { key: legacyKey, name: legacyName || legacyKey };
  }
  return { key: '', name: '' };
}

function saveDefaultCollection(key, name) {
  key = String(key || '').trim();
  if (!key) {
    throw new Error('Wybierz kolekcję z listy lub wpisz klucz ręcznie.');
  }
  if (!/^[A-Za-z0-9]{8}$/.test(key)) {
    throw new Error(
      'Klucz kolekcji musi mieć dokładnie 8 znaków (litery i cyfry), np. FVIAD3D8 z adresu zotero.org.'
    );
  }
  var docProps = PropertiesService.getDocumentProperties();
  docProps.setProperty(PROP_DEFAULT_COLLECTION_KEY, key);
  docProps.setProperty(PROP_DEFAULT_COLLECTION_NAME, name || key);
  return getDefaultCollection();
}

function importDoi(doi, options) {
  var payload = { doi: doi };
  if (options && options.study) {
    payload.study = options.study;
  } else if (options && options.collectionKey) {
    payload.collection_key = options.collectionKey;
  }
  var result = apiPost('/import/doi', payload);
  var itemKey = result.item_key || extractItemKey_(result.result || result);
  var citationText = result.citation_text || '';
  if (!citationText && itemKey) {
    try {
      citationText = getItemCitationText(itemKey, getBibliographyStyle());
    } catch (e) {
      citationText = '';
    }
  }
  // Automatyczna podmiana [*] tylko w trybie placeholderowym — w trybie kursora
  // import nie powinien nic wstawiać do dokumentu bez decyzji użytkownika.
  if (citationText && !result.duplicate && getCitationInsertMode() === 'placeholder') {
    try {
      replacePlaceholderInDocument_(citationText, buildIdentifiers_('doi', result.doi || doi), itemKey);
      result.placeholder_replaced = true;
    } catch (e) {
      result.placeholder_error = e.message;
    }
  }
  if (itemKey) {
    rememberSessionItem_(result, itemKey, citationText);
  }
  return result;
}

function importOrcid(orcid, options, limit) {
  var payload = {
    orcid: orcid,
    limit: limit || 50,
  };
  if (options && options.study) {
    payload.study = options.study;
  } else if (options && options.collectionKey) {
    payload.collection_key = options.collectionKey;
  }
  return apiPost('/import/orcid', payload);
}

/**
 * Ręczne utworzenie pozycji Zotero (zakładka Inne).
 * payload: { itemType, title, creators, … } + options.collectionKey / study
 */
function importManual(itemPayload, options) {
  var payload = {};
  var src = itemPayload || {};
  Object.keys(src).forEach(function (k) {
    payload[k] = src[k];
  });
  if (options && options.study) {
    payload.study = options.study;
  } else if (options && options.collectionKey) {
    payload.collection_key = options.collectionKey;
  }
  var result = apiPost('/import/manual', payload);
  var itemKey = result.item_key || extractItemKey_(result.result || result);
  var citationText = result.citation_text || '';
  if (!citationText && itemKey) {
    try {
      citationText = getItemCitationText(itemKey, getBibliographyStyle());
    } catch (e) {
      citationText = '';
    }
  }
  if (citationText && !result.duplicate && getCitationInsertMode() === 'placeholder') {
    try {
      replacePlaceholderInDocument_(
        citationText,
        buildIdentifiers_('doi', result.doi || ''),
        itemKey
      );
      result.placeholder_replaced = true;
    } catch (e) {
      result.placeholder_error = e.message;
    }
  }
  if (itemKey) {
    rememberSessionItem_(result, itemKey, citationText);
  }
  result.item_key = itemKey || result.item_key || '';
  result.citation_text = citationText;
  return result;
}

/**
 * Gemini: tekst → draft pól (bez zapisu do Zotero).
 * Klucz z Script Properties idzie w nagłówku X-Gemini-Api-Key (nie w body / lastImport).
 * Zwraca { draft, warnings, model } albo rzuca z komunikatem 503 gdy brak klucza.
 */
function describeManualItem(itemType, text) {
  var path = '/import/describe';
  if (getDebugMode()) {
    path += '?debug=1';
  }
  var headers = apiHeaders_();
  var geminiKey = getGeminiApiKey();
  if (geminiKey) {
    headers['X-Gemini-Api-Key'] = geminiKey;
  }
  var response = UrlFetchApp.fetch(API_BASE + path, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      item_type: String(itemType || '').trim(),
      text: String(text || ''),
    }),
    muteHttpExceptions: true,
    headers: headers,
  });
  var parsed = parseResponse_(response);
  // Nie zapisuj pełnego lastImport z tekstem źródłowym — tylko ścieżka i skrót wyniku.
  PropertiesService.getDocumentProperties().setProperty(
    'lastImport',
    JSON.stringify({
      at: new Date().toISOString(),
      path: path,
      result: {
        model: parsed && parsed.model,
        warnings: parsed && parsed.warnings,
        draft_title: parsed && parsed.draft && parsed.draft.title,
      },
    })
  );
  return parsed;
}

/** Klucz Gemini z Script Properties (pusty string jeśli brak). Tylko do wywołań serwerowych. */
function getGeminiApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty(PROP_GEMINI_API_KEY);
  return key ? String(key).trim() : '';
}

/** Czy Script Properties ma klucz Gemini (bez ujawniania wartości do HTML). */
function hasGeminiApiKey() {
  return !!getGeminiApiKey();
}

/**
 * Zapisuje klucz Gemini w Script Properties (per projekt Apps Script).
 * Pusty string usuwa klucz. Nigdy nie commituj klucza do repo.
 */
function saveGeminiApiKey(key) {
  key = String(key || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (!key) {
    props.deleteProperty(PROP_GEMINI_API_KEY);
    return { configured: false };
  }
  props.setProperty(PROP_GEMINI_API_KEY, key);
  return { configured: true };
}

/**
 * Czy Gemini jest dostępne: klucz w Script Properties (Ustawienia)
 * albo opcjonalny GEMINI_API_KEY na serwerze (health?verbose=1).
 */
function getGeminiConfigured() {
  if (getGeminiApiKey()) {
    return true;
  }
  try {
    var response = UrlFetchApp.fetch(API_BASE + '/health?verbose=1', {
      method: 'get',
      muteHttpExceptions: true,
      headers: { Accept: 'application/json' },
    });
    var body = {};
    try {
      body = JSON.parse(response.getContentText() || '{}');
    } catch (ignore) {
      body = {};
    }
    return !!body.gemini_configured;
  } catch (e) {
    return false;
  }
}

function getCollectionItems(collectionKey, limit) {
  var key = String(collectionKey || '').trim();
  if (!key) {
    throw new Error('Brak klucza kolekcji.');
  }
  var lim = limit || 20;
  return apiGet('/collection-items?collection_key=' + encodeURIComponent(key) + '&limit=' + lim);
}

function removeFromCollection(collectionKey, itemKey) {
  var coll = String(collectionKey || '').trim();
  var item = String(itemKey || '').trim();
  if (!coll) {
    throw new Error('Brak klucza kolekcji.');
  }
  if (!item) {
    throw new Error('Brak klucza pozycji.');
  }
  return apiDelete(
    '/collections/' + encodeURIComponent(coll) + '/items/' + encodeURIComponent(item)
  );
}

function getBibliographyStyles() {
  return apiGet('/styles');
}

function getAddonVersion() {
  return ADDON_VERSION;
}

/**
 * Szybki ping Django (GET /health) — bez klucza API.
 * Zwraca obiekt statusu zamiast rzucać, żeby kropka w sidebarze mogła pokazać błąd.
 */
function pingApiHealth() {
  var checkedAt = new Date().toISOString();
  try {
    var response = UrlFetchApp.fetch(API_BASE + '/health', {
      method: 'get',
      muteHttpExceptions: true,
      headers: { Accept: 'application/json' },
    });
    var code = response.getResponseCode();
    var body = {};
    try {
      body = JSON.parse(response.getContentText() || '{}');
    } catch (ignore) {
      body = {};
    }
    var ok = code >= 200 && code < 300 && body.status === 'ok';
    return {
      ok: ok,
      status: ok ? 'ok' : 'error',
      build: body.build || '',
      http: code,
      checkedAt: checkedAt,
      error: ok ? '' : String(body.error || body.detail || ('HTTP ' + code)),
    };
  } catch (e) {
    return {
      ok: false,
      status: 'error',
      build: '',
      http: 0,
      checkedAt: checkedAt,
      error: String((e && e.message) || e),
    };
  }
}

/**
 * Lekki check Django ↔ Zotero (GET /health/zotero) — z X-API-Key.
 * status: ok | error | no_key
 */
function pingZoteroHealth() {
  var checkedAt = new Date().toISOString();
  var apiKey = PropertiesService.getScriptProperties().getProperty('ZOTERO20_API_KEY');
  if (!apiKey) {
    return {
      ok: false,
      status: 'no_key',
      zotero: null,
      http: 0,
      checkedAt: checkedAt,
      error: 'Brak ZOTERO20_API_KEY w Script Properties.',
    };
  }
  try {
    var response = UrlFetchApp.fetch(API_BASE + '/health/zotero', {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
    });
    var code = response.getResponseCode();
    var body = {};
    try {
      body = JSON.parse(response.getContentText() || '{}');
    } catch (ignore) {
      body = {};
    }
    var zotero = body.zotero || null;
    var ok = code >= 200 && code < 300 && body.status === 'ok' && zotero && zotero.reachable;
    var err = '';
    if (!ok) {
      err = String(
        (zotero && zotero.error) || body.error || body.detail || ('HTTP ' + code)
      );
    }
    return {
      ok: !!ok,
      status: ok ? 'ok' : 'error',
      zotero: zotero,
      http: code,
      checkedAt: checkedAt,
      error: err,
    };
  } catch (e) {
    return {
      ok: false,
      status: 'error',
      zotero: null,
      http: 0,
      checkedAt: checkedAt,
      error: String((e && e.message) || e),
    };
  }
}

/** Styl jest wspólny dla cytowań w tekście i bibliografii — jedno źródło prawdy na dokument. */
function getBibliographyStyle() {
  var docProps = PropertiesService.getDocumentProperties();
  var style = docProps.getProperty(PROP_BIBLIOGRAPHY_STYLE);
  if (style) {
    return style;
  }
  // Wcześniej styl był globalny (ScriptProperties) i „przeciekał” między dokumentami.
  var legacy = PropertiesService.getScriptProperties().getProperty(PROP_BIBLIOGRAPHY_STYLE);
  if (legacy) {
    docProps.setProperty(PROP_BIBLIOGRAPHY_STYLE, legacy);
    return legacy;
  }
  return 'apa';
}

function saveBibliographyStyle(styleId) {
  styleId = String(styleId || '').trim();
  if (!styleId) {
    throw new Error('Wybierz styl cytowań.');
  }
  PropertiesService.getDocumentProperties().setProperty(PROP_BIBLIOGRAPHY_STYLE, styleId);
  return getBibliographyStyle();
}

var DEFAULT_CITATION_LOCALE = 'en-US';

function normalizeCitationLocale_(value) {
  var lower = String(value || '').trim().replace('_', '-').toLowerCase();
  if (lower === 'en-us') {
    return 'en-US';
  }
  if (lower === 'pl-pl') {
    return 'pl-PL';
  }
  return '';
}

/** Język CSL cytowań i bibliografii (et al. / i in.) — per dokument, niezależny od języka panelu. */
function getCitationLocale() {
  var saved = PropertiesService.getDocumentProperties().getProperty(PROP_CITATION_LOCALE);
  var resolved = normalizeCitationLocale_(saved);
  return resolved || DEFAULT_CITATION_LOCALE;
}

function saveCitationLocale(locale) {
  var resolved = normalizeCitationLocale_(locale);
  if (!resolved) {
    throw new Error('Wybierz język cytowań: English albo Polski.');
  }
  PropertiesService.getDocumentProperties().setProperty(PROP_CITATION_LOCALE, resolved);
  return getCitationLocale();
}

function getCitationInsertMode() {
  var mode = PropertiesService.getDocumentProperties().getProperty(PROP_CITATION_INSERT_MODE);
  return mode === 'placeholder' ? 'placeholder' : 'cursor';
}

function saveCitationInsertMode(mode) {
  PropertiesService.getDocumentProperties().setProperty(
    PROP_CITATION_INSERT_MODE,
    mode === 'placeholder' ? 'placeholder' : 'cursor'
  );
  return getCitationInsertMode();
}

function getDebugMode() {
  return PropertiesService.getScriptProperties().getProperty(PROP_DEBUG) === 'true';
}

function saveDebugMode(enabled) {
  PropertiesService.getScriptProperties().setProperty(PROP_DEBUG, enabled ? 'true' : 'false');
  return getDebugMode();
}

function getBibliographyCitedOnly() {
  var val = PropertiesService.getDocumentProperties().getProperty(PROP_BIBLIOGRAPHY_CITED_ONLY);
  if (val === null || val === undefined || val === '') {
    return true;
  }
  return val === 'true';
}

function saveBibliographyCitedOnly(enabled) {
  PropertiesService.getDocumentProperties().setProperty(
    PROP_BIBLIOGRAPHY_CITED_ONLY,
    enabled ? 'true' : 'false'
  );
  return getBibliographyCitedOnly();
}

/** Czcionka bibliografii — pusta = domyślna dokumentu. */
function getBibliographyFont() {
  var saved = PropertiesService.getDocumentProperties().getProperty(PROP_BIBLIOGRAPHY_FONT);
  saved = String(saved || '').trim();
  return BIBLIOGRAPHY_ALLOWED_FONTS[saved] ? saved : '';
}

function saveBibliographyFont(fontFamily) {
  fontFamily = String(fontFamily || '').trim();
  if (fontFamily && !BIBLIOGRAPHY_ALLOWED_FONTS[fontFamily]) {
    throw new Error('Nieobsługiwana czcionka bibliografii.');
  }
  PropertiesService.getDocumentProperties().setProperty(PROP_BIBLIOGRAPHY_FONT, fontFamily);
  return getBibliographyFont();
}

/** Rozmiar czcionki bibliografii w pt — 0/puste = bez wymuszania. */
function getBibliographyFontSize() {
  var raw = PropertiesService.getDocumentProperties().getProperty(PROP_BIBLIOGRAPHY_FONT_SIZE);
  var size = parseInt(String(raw || '').trim(), 10);
  return BIBLIOGRAPHY_ALLOWED_FONT_SIZES[size] ? size : 0;
}

function saveBibliographyFontSize(size) {
  if (size === null || size === undefined || size === '') {
    PropertiesService.getDocumentProperties().setProperty(PROP_BIBLIOGRAPHY_FONT_SIZE, '');
    return getBibliographyFontSize();
  }
  var n = parseInt(String(size).trim(), 10);
  if (!BIBLIOGRAPHY_ALLOWED_FONT_SIZES[n]) {
    throw new Error('Rozmiar czcionki bibliografii: wybierz 9, 10, 11, 12 lub 14 pt.');
  }
  PropertiesService.getDocumentProperties().setProperty(PROP_BIBLIOGRAPHY_FONT_SIZE, String(n));
  return getBibliographyFontSize();
}

/**
 * Zmiana stylu w jednym kroku: przelicza wszystkie cytowania w tekście
 * i bibliografię z tej samej odpowiedzi serwera, więc numeracja i format
 * nie mogą się rozjechać.
 */
function applyCitationStyle(styleId, options) {
  options = options || {};
  if (styleId) {
    saveBibliographyStyle(styleId);
  }
  var style = getBibliographyStyle();
  var citations = getTrackedCitations_();

  if (!citations.length) {
    return {
      style: style,
      cited_count: 0,
      updated: 0,
      bibliography: null,
      message:
        'Brak śledzonych cytowań w dokumencie. Wstaw cytowanie przyciskiem „Wstaw cytowanie” ' +
        '— dopiero wtedy styl i bibliografia mają co przeliczać.',
    };
  }

  var data = fetchDocumentCitations_(citations, style);
  var updated = rewriteCitationRuns_(
    citations,
    data.citation_by_key,
    data.title_by_key,
    !!data.numeric
  );

  var bibliography = null;
  var bibliographyError = '';
  if (options.skipBibliography) {
    bibliography = null;
  } else if (!data.entries.length) {
    bibliographyError = 'Serwer nie zwrócił wpisów bibliografii dla cytowanych pozycji.';
  } else {
    try {
      // Bibliografia dopisywana jest tylko, gdy już istnieje albo user o nią prosi.
      var mustExist = !options.createBibliography;
      bibliography = writeBibliographyToDocument_(data.entries, data.style_label, mustExist);
    } catch (e) {
      bibliographyError = e.message || String(e);
      if (getDebugMode()) {
        bibliographyError += '\n[debug] ' + (e.stack || '');
      }
    }
  }

  var result = {
    style: data.style,
    style_label: data.style_label,
    numeric: !!data.numeric,
    document_citation_count: citations.length,
    cited_count: data.item_keys.length,
    updated: updated.updated,
    unchanged: updated.unchanged,
    skipped: updated.skipped,
    collapsed: updated.collapsed || 0,
    missing_item_keys: data.missing_item_keys,
    bibliography: bibliography,
    bibliography_error: bibliographyError,
  };
  if (getDebugMode()) {
    result.debug = {
      item_keys: data.item_keys,
      citation_by_key: data.citation_by_key,
      rewrite: updated,
    };
  }
  return result;
}

/** Zgodność wstecz z poprzednią wersją sidebara. */
function refreshInTextCitations() {
  var result = applyCitationStyle('', { skipBibliography: true });
  return {
    updated: result.updated || 0,
    skipped: result.skipped || 0,
    errors: [],
    style: result.style,
    message: result.message || '',
  };
}

function getDocumentCitationSummary() {
  var citations = getTrackedCitations_();
  var keys = uniqueItemKeys_(citations);
  return {
    style: getBibliographyStyle(),
    locale: getCitationLocale(),
    insert_mode: getCitationInsertMode(),
    citation_count: citations.length,
    item_count: keys.length,
    item_keys: keys,
    has_bibliography: hasBibliographySection_(),
    version: ADDON_VERSION,
  };
}

function insertBibliography(citedOnly) {
  return upsertBibliography_(false, citedOnly);
}

function refreshBibliography(citedOnly) {
  return upsertBibliography_(true, citedOnly);
}

function upsertBibliography_(isRefresh, citedOnly) {
  if (citedOnly === undefined || citedOnly === null) {
    citedOnly = getBibliographyCitedOnly();
  } else {
    citedOnly = !!citedOnly;
  }

  var style = getBibliographyStyle();

  if (citedOnly) {
    var result = applyCitationStyle(style, { createBibliography: !isRefresh });
    if (!result.cited_count) {
      // Świadomie bez fallbacku na całą kolekcję — to był najgorszy błąd poprzedniej wersji.
      throw new Error(
        'Brak cytowań w dokumencie, więc nie ma z czego zbudować bibliografii. ' +
        'Wstaw cytowania przyciskiem „Wstaw cytowanie”, albo zaznacz „Wstaw CAŁĄ kolekcję”, ' +
        'jeśli naprawdę chcesz wszystkie pozycje z kolekcji.'
      );
    }
    if (result.bibliography_error) {
      throw new Error(result.bibliography_error);
    }
    return {
      inserted: result.bibliography ? result.bibliography.inserted : false,
      refreshed: result.bibliography ? result.bibliography.refreshed : false,
      style: result.style,
      style_label: result.style_label,
      item_count: result.bibliography ? result.bibliography.item_count : 0,
      cited_only: true,
      cited_count: result.cited_count,
      updated_citations: result.updated,
      missing_item_keys: result.missing_item_keys,
    };
  }

  var collection = getDefaultCollection();
  if (!collection.key) {
    throw new Error('Tryb „cała kolekcja” wymaga kolekcji tego dokumentu — ustaw ją w zakładce Ustawienia.');
  }

  var data = apiPost('/bibliography', {
    style: style,
    collection_key: collection.key,
    locale: getCitationLocale(),
  });
  var entries = normalizeEntries_(data.entries);
  if (!entries.length) {
    throw new Error(
      (data.item_count || 0) > 0
        ? 'Zotero zwróciło pustą bibliografię mimo pozycji w kolekcji — spróbuj inny styl lub odśwież za chwilę.'
        : 'Kolekcja jest pusta — brak pozycji do bibliografii.'
    );
  }

  var written = writeBibliographyToDocument_(entries, data.style_label || style, isRefresh);
  written.collection_key = collection.key;
  written.collection_name = collection.name;
  written.style = data.style || style;
  written.style_label = data.style_label || style;
  written.cited_only = false;
  written.cited_count = 0;
  return written;
}

function normalizeEntries_(entries) {
  return (entries || [])
    .map(function (entry) { return String(entry).trim(); })
    .filter(function (entry) { return entry; });
}

/** Jedno żądanie zwraca i cytowania w tekście, i wpisy bibliografii dla tego samego stylu. */
function fetchDocumentCitations_(citations, style) {
  var keys = uniqueItemKeys_(citations);
  var data = apiPost('/citations', {
    style: style,
    item_keys: keys,
    locale: getCitationLocale(),
  });
  var byKey = {};
  var titleByKey = {};
  var list = data.citations || [];
  var orderedKeys = (data.item_keys || keys).map(normalizeItemKey_);
  var entries = normalizeEntries_(data.entries);
  if (data.numeric) {
    for (var e = 0; e < orderedKeys.length; e++) {
      if (entries[e]) {
        titleByKey[orderedKeys[e]] = stripLeadingBibNumber_(entries[e]);
      }
    }
  }
  for (var i = 0; i < list.length; i++) {
    var text = String(list[i].citation_text || '').trim();
    var key = normalizeItemKey_(list[i].item_key);
    if (key && text) {
      byKey[key] = text;
    }
    var fromCite = usefulHoverTitle_(text);
    if (key && fromCite) {
      titleByKey[key] = fromCite;
    }
  }
  return {
    citation_by_key: byKey,
    title_by_key: titleByKey,
    entries: entries,
    style: data.style || style,
    style_label: data.style_label || style,
    numeric: !!data.numeric,
    item_keys: (data.item_keys || keys).map(normalizeItemKey_),
    missing_item_keys: data.missing_item_keys || [],
  };
}

/**
 * Wstawia lub odświeża sekcję bibliografii na końcu dokumentu.
 * Zakres oznaczony NamedRange ZOTERO20_BIBLIOGRAPHY, z awaryjnym
 * wyszukiwaniem po nagłówku (NamedRange bywa gubiony przy edycji).
 */
function writeBibliographyToDocument_(entries, styleLabel, mustExist) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var section = locateBibliographySection_(doc, body);

  if (mustExist && !section) {
    throw new Error('Brak bibliografii w dokumencie — użyj „Wstaw bibliografię”.');
  }

  if (section) {
    removeBibliographyNamedRanges_(doc);
    var startIdx = updateBibliographyInPlace_(body, section.startIdx, section.endIdx, entries);
    applyBibliographyAppearance_(body, startIdx, entries.length);
    attachBibliographyNamedRange_(doc, body, startIdx, entries.length);
    return {
      inserted: false,
      refreshed: true,
      item_count: entries.length,
      style_label: styleLabel,
    };
  }

  body.appendParagraph(BIBLIOGRAPHY_HEADING).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  var startIdx = body.getNumChildren() - 1;

  for (var i = 0; i < entries.length; i++) {
    body.appendParagraph(String(entries[i]));
  }

  applyBibliographyAppearance_(body, startIdx, entries.length);
  attachBibliographyNamedRange_(doc, body, startIdx, entries.length);

  return {
    inserted: true,
    refreshed: false,
    item_count: entries.length,
    style_label: styleLabel,
  };
}

/**
 * Nakłada czcionkę i rozmiar z Document Properties na nagłówek + wpisy bibliografii.
 * Puste ustawienia = bez zmian (domyślne style dokumentu / nagłówka).
 */
function applyBibliographyAppearance_(body, startIdx, entryCount) {
  var font = getBibliographyFont();
  var size = getBibliographyFontSize();
  if (!font && !size) {
    return;
  }
  var endIdx = startIdx + entryCount;
  for (var i = startIdx; i <= endIdx && i < body.getNumChildren(); i++) {
    var child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) {
      continue;
    }
    var te = child.asParagraph().editAsText();
    var len = te.getText().length;
    if (len < 1) {
      continue;
    }
    if (font) {
      te.setFontFamily(0, len - 1, font);
    }
    if (size) {
      te.setFontSize(0, len - 1, size);
    }
  }
}

function attachBibliographyNamedRange_(doc, body, startIdx, entryCount) {
  var rangeBuilder = doc.newRange();
  var endIdx = startIdx + entryCount;
  for (var j = startIdx; j <= endIdx && j < body.getNumChildren(); j++) {
    var child = body.getChild(j);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) {
      continue;
    }
    var paragraph = child.asParagraph();
    if (!paragraph.getText()) {
      continue;
    }
    rangeBuilder.addElement(paragraph);
  }
  doc.addNamedRange(NAMED_RANGE_BIBLIOGRAPHY, rangeBuilder.build());
}

function removeBibliographyNamedRanges_(doc) {
  var named = doc.getNamedRanges(NAMED_RANGE_BIBLIOGRAPHY);
  for (var n = 0; n < named.length; n++) {
    named[n].remove();
  }
}

function locateBibliographySection_(doc, body) {
  var named = doc.getNamedRanges(NAMED_RANGE_BIBLIOGRAPHY);
  if (named && named.length) {
    var indices = collectBodyChildIndicesFromNamed_(named);
    if (indices.length) {
      indices.sort(function (a, b) { return a - b; });
      return { startIdx: indices[0], endIdx: indices[indices.length - 1] };
    }
  }

  var headingIdx = findBibliographyHeadingIndex_(body);
  if (headingIdx < 0) {
    return null;
  }
  var endIdx = headingIdx;
  for (var k = headingIdx + 1; k < body.getNumChildren(); k++) {
    var next = body.getChild(k);
    if (
      next.getType() === DocumentApp.ElementType.PARAGRAPH &&
      next.asParagraph().getHeading() === DocumentApp.ParagraphHeading.HEADING1
    ) {
      break;
    }
    endIdx = k;
  }
  return { startIdx: headingIdx, endIdx: endIdx };
}

function collectBodyChildIndicesFromNamed_(namedRanges) {
  var seen = {};
  for (var n = 0; n < namedRanges.length; n++) {
    var elements = namedRanges[n].getRange().getRangeElements();
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i].getElement();
      if (!element || !element.getParent) {
        continue;
      }
      var parent = element.getParent();
      if (parent && parent.getType && parent.getType() === DocumentApp.ElementType.BODY) {
        var idx = parent.getChildIndex(element);
        if (idx >= 0) {
          seen[idx] = true;
        }
      }
    }
  }
  return Object.keys(seen).map(function (k) { return parseInt(k, 10); });
}

/**
 * Aktualizuje sekcję bibliografii w miejscu — bez kasowania całego dokumentu
 * (unika błędu „Nie można usunąć ostatniego rozdziału…”).
 */
function updateBibliographyInPlace_(body, startIdx, endIdx, entries) {
  var heading = body.getChild(startIdx).asParagraph();
  heading.setText(BIBLIOGRAPHY_HEADING);
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);

  var i;
  for (i = 0; i < entries.length; i++) {
    var targetIdx = startIdx + 1 + i;
    if (targetIdx <= endIdx && targetIdx < body.getNumChildren()) {
      var paragraph = body.getChild(targetIdx).asParagraph();
      paragraph.setHeading(DocumentApp.ParagraphHeading.NORMAL);
      paragraph.setText(String(entries[i]));
    } else {
      body.insertParagraph(targetIdx, String(entries[i]));
      endIdx++;
    }
  }

  var excessStart = startIdx + 1 + entries.length;
  for (var j = endIdx; j >= excessStart; j--) {
    if (j < 0 || j >= body.getNumChildren()) {
      continue;
    }
    var child = body.getChild(j);
    if (body.getNumChildren() <= 1) {
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        child.asParagraph().clear();
      }
      continue;
    }
    child.removeFromParent();
  }

  return startIdx;
}

function hasBibliographySection_() {
  var doc = DocumentApp.getActiveDocument();
  return locateBibliographySection_(doc, doc.getBody()) !== null;
}

function findBibliographyHeadingIndex_(body) {
  var wanted = BIBLIOGRAPHY_HEADING.toLowerCase();
  for (var i = 0; i < body.getNumChildren(); i++) {
    var child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) {
      continue;
    }
    var paragraph = child.asParagraph();
    if (
      paragraph.getHeading() === DocumentApp.ParagraphHeading.HEADING1 &&
      paragraph.getText().trim().toLowerCase() === wanted
    ) {
      return i;
    }
  }
  return -1;
}

function removeBibliographySection_(doc, body) {
  var section = locateBibliographySection_(doc, body);
  if (!section) {
    return false;
  }

  removeBibliographyNamedRanges_(doc);

  var indices = [];
  for (var k = section.startIdx; k <= section.endIdx; k++) {
    indices.push(k);
  }

  indices.sort(function (a, b) { return b - a; });
  for (var j = 0; j < indices.length; j++) {
    if (indices[j] >= body.getNumChildren()) {
      continue;
    }
    if (body.getNumChildren() <= 1) {
      var only = body.getChild(indices[j]);
      if (only.getType() === DocumentApp.ElementType.PARAGRAPH) {
        only.asParagraph().clear();
      }
      continue;
    }
    body.getChild(indices[j]).removeFromParent();
  }

  return true;
}

function getItemCitationText(itemKey, style) {
  var key = String(itemKey || '').trim();
  if (!key) {
    throw new Error('Brak klucza pozycji.');
  }
  var path = '/items/' + encodeURIComponent(key);
  var params = [];
  if (style) {
    params.push('style=' + encodeURIComponent(style));
  }
  var locale = getCitationLocale();
  if (locale) {
    params.push('locale=' + encodeURIComponent(locale));
  }
  if (params.length) {
    path += '?' + params.join('&');
  }
  var data = apiGet(path);
  if (data.citation_text) {
    return data.citation_text;
  }
  if (data.item && data.item.citation_text) {
    return data.item.citation_text;
  }
  return formatCitationText_(data.item || {});
}

/**
 * Wstawia śledzone cytowanie: w miejscu kursora (domyślnie) albo zamiast [*].
 * Po wstawieniu przelicza cały dokument, żeby numeracja stylów numerycznych
 * i bibliografia pozostały spójne — tak jak robi to wtyczka Zotero.
 */
function insertCitationForItem(itemKey, identifiers, mode) {
  var key = normalizeItemKey_(itemKey);
  if (!key) {
    throw new Error('Brak klucza pozycji — zaimportuj DOI ponownie lub wybierz pozycję z listy.');
  }

  var style = getBibliographyStyle();
  var citationText = '';
  try {
    citationText = getItemCitationText(key, style);
  } catch (e) {
    throw new Error('Nie udało się pobrać cytowania: ' + (e.message || String(e)));
  }
  if (!citationText) {
    throw new Error('Brak tekstu cytowania dla pozycji ' + key + '.');
  }

  mode = mode === 'placeholder' || mode === 'cursor' ? mode : getCitationInsertMode();
  var hoverHint = identifiers && identifiers.hoverTitle;
  var hoverTitle = citationHoverTitle_(citationText, '', hoverHint);
  var placeholderIds = identifiers || {};
  if (mode === 'placeholder') {
    placeholderIds = enrichIdentifiersForPlaceholder_(placeholderIds, key);
  }
  var placement =
    mode === 'placeholder'
      ? replacePlaceholderInDocument_(citationText, placeholderIds, key, hoverTitle)
      : insertCitationAtCursor_(citationText, key, hoverTitle);

  var result = {
    replaced: true,
    tracked: true,
    item_key: key,
    citation_text: citationText,
    mode: placement.mode,
  };

  try {
    var restyled = applyCitationStyle('', { skipBibliography: !hasBibliographySection_() });
    result.cited_count = restyled.cited_count;
    result.numeric = restyled.numeric;
    result.bibliography_refreshed = !!restyled.bibliography;
    if (restyled.numeric) {
      result.citation_text = '[' + restyled.cited_count + ']';
    }
  } catch (e) {
    result.restyle_error = e.message || String(e);
  }

  return result;
}

/** Zgodność wstecz z poprzednią wersją sidebara. */
function pasteCitationForItem(itemKey, identifiers) {
  return insertCitationForItem(itemKey, identifiers, 'placeholder');
}

/** Widoczny komunikat w dokumencie (modal) — wywoływany z sidebara po wklejeniu. */
function showPasteAlert(message, isError) {
  var title = isError ? 'Zotero20 — błąd' : 'Zotero20';
  DocumentApp.getUi().alert(title, String(message || ''), DocumentApp.getUi().ButtonSet.OK);
}

/**
 * Zamienia pierwszy placeholder w dokumencie na podany tekst.
 * Gdy podano itemKey, cytowanie dostaje kotwicę-link i jest dalej śledzone.
 * Kolejność: [*], potem [identyfikator] dopasowany do importu.
 */
function replacePlaceholderInDocument_(text, identifiers, itemKey, hoverTitle) {
  identifiers = identifiers || {};
  var body = DocumentApp.getActiveDocument().getBody();
  var patterns = buildPlaceholderPatterns_(identifiers);

  for (var i = 0; i < patterns.length; i++) {
    var result = replaceFirstLiteral_(body, patterns[i], text);
    if (result) {
      if (itemKey) {
        applyCitationLink_(
          result.textElement,
          result.start,
          result.end,
          itemKey,
          newCitationId_(),
          hoverTitle
        );
      }
      return { mode: 'placeholder', pattern: patterns[i], text: text, item_key: itemKey || '' };
    }
  }

  throw new Error(
    'Brak placeholdera w dokumencie — wpisz np. [*], [DOI], [10.xxxx/…] albo [DOI:10.xxxx/…] ' +
    'i spróbuj ponownie, albo przełącz wstawianie na „w miejscu kursora”.'
  );
}

/** Wstawia cytowanie tam, gdzie stoi kursor w dokumencie. */
function insertCitationAtCursor_(text, itemKey, hoverTitle) {
  var doc = DocumentApp.getActiveDocument();
  var cursor = doc.getCursor();
  if (!cursor) {
    throw new Error(
      'Nie widzę kursora w dokumencie — kliknij w tekst w miejscu cytowania i spróbuj ponownie ' +
      '(albo przełącz wstawianie na tryb [*]).'
    );
  }

  var textElement = cursor.getSurroundingText();
  if (!textElement) {
    throw new Error('Ustaw kursor w akapicie tekstu — w tym miejscu nie da się wstawić cytowania.');
  }

  var offset = cursor.getSurroundingTextOffset();
  textElement.insertText(offset, text);
  applyCitationLink_(
    textElement,
    offset,
    offset + text.length - 1,
    itemKey,
    newCitationId_(),
    hoverTitle
  );
  return { mode: 'cursor', text: text, item_key: itemKey };
}

function newCitationId_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function buildCitationUrl_(itemKey, citationId, displayTitle) {
  var url =
    CITE_LINK_BASE +
    encodeURIComponent(normalizeItemKey_(itemKey)) +
    '?c=' +
    encodeURIComponent(citationId || newCitationId_());
  var title = sanitizeCiteTitle_(displayTitle);
  if (title) {
    url += '&t=' + encodeURIComponent(title);
  }
  return url;
}

function normalizeItemKey_(itemKey) {
  return String(itemKey || '').trim().toUpperCase();
}

function sanitizeCiteTitle_(raw) {
  var text = String(raw || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > 80) {
    var cut = text.substring(0, 80);
    var space = cut.lastIndexOf(' ');
    text = (space >= 40 ? cut.substring(0, space) : cut).trim();
  }
  return text;
}

function stripLeadingBibNumber_(text) {
  return String(text || '').replace(/^\s*\[\d+\]\s*/, '').trim();
}

function stripOuterParens_(text) {
  var value = String(text || '').trim();
  var wrapped = /^\((.*)\)$/.exec(value);
  if (wrapped) {
    return wrapped[1].trim();
  }
  return value;
}

function usefulHoverTitle_(raw) {
  var original = String(raw || '').trim();
  if (!original || /^\[\d+\]$/.test(original)) {
    return '';
  }
  var text = sanitizeCiteTitle_(stripOuterParens_(stripLeadingBibNumber_(original)));
  if (!text || /^\d+$/.test(text)) {
    return '';
  }
  return text;
}

function citationHoverTitle_(citationText, bibEntry, existingTitle) {
  return (
    usefulHoverTitle_(citationText) ||
    usefulHoverTitle_(bibEntry) ||
    sanitizeCiteTitle_(existingTitle) ||
    ''
  );
}

function parseCitationUrl_(url) {
  if (!url) {
    return null;
  }
  var match = /^(?:https?:\/\/)?(?:www\.)?zotero\.keyweb\.pl\/cite\/([^?#\s]+)/i.exec(String(url));
  if (!match) {
    return null;
  }
  var itemKey = '';
  try {
    itemKey = normalizeItemKey_(decodeURIComponent(match[1]));
  } catch (e) {
    itemKey = normalizeItemKey_(match[1]);
  }
  if (!itemKey) {
    return null;
  }
  var citationId = '';
  var queryMatch = /[?&]c=([^&#]*)/i.exec(String(url));
  if (queryMatch) {
    citationId = queryMatch[1];
  }
  var displayTitle = '';
  var titleMatch = /[?&]t=([^&#]*)/i.exec(String(url));
  if (titleMatch && titleMatch[1]) {
    try {
      displayTitle = decodeURIComponent(String(titleMatch[1]).replace(/\+/g, ' '));
    } catch (e) {
      displayTitle = titleMatch[1];
    }
  }
  return { itemKey: itemKey, citationId: citationId, displayTitle: displayTitle };
}

function linkUrlAtOffset_(textElement, start, end) {
  var url = textElement.getLinkUrl(start) || '';
  if (!url && end > start) {
    url = textElement.getLinkUrl(end) || '';
  }
  if (!url) {
    var mid = Math.floor((start + end) / 2);
    url = textElement.getLinkUrl(mid) || '';
  }
  return url;
}

/**
 * Nakłada kotwicę cytowania i zdejmuje domyślny wygląd hiperłącza,
 * żeby cytowanie w tekście wyglądało jak zwykły tekst.
 */
function applyCitationLink_(textElement, start, end, itemKey, citationId, displayTitle) {
  if (end < start) {
    return;
  }
  textElement.setLinkUrl(start, end, buildCitationUrl_(itemKey, citationId, displayTitle));
  textElement.setUnderline(start, end, false);
  textElement.setForegroundColor(start, end, '#000000');
}

/** Wszystkie cytowania w dokumencie, w kolejności występowania. */
function getTrackedCitations_() {
  migrateLegacyNamedRanges_();
  var runs = [];
  var doc = DocumentApp.getActiveDocument();
  collectCitationRuns_(doc.getBody(), runs);
  var footnotes = doc.getFootnotes();
  for (var f = 0; f < footnotes.length; f++) {
    collectCitationRuns_(footnotes[f].getFootnoteContents(), runs);
  }
  return runs;
}

function collectCitationRuns_(container, runs) {
  var count = container.getNumChildren();
  for (var i = 0; i < count; i++) {
    var child = container.getChild(i);
    var type = child.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH) {
      collectRunsFromText_(child.asParagraph().editAsText(), runs);
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      collectRunsFromText_(child.asListItem().editAsText(), runs);
    } else if (type === DocumentApp.ElementType.TABLE) {
      var table = child.asTable();
      for (var r = 0; r < table.getNumRows(); r++) {
        var row = table.getRow(r);
        for (var c = 0; c < row.getNumCells(); c++) {
          collectCitationRuns_(row.getCell(c), runs);
        }
      }
    }
  }
}

function collectRunsFromText_(textElement, runs) {
  var text = textElement.getText();
  if (!text) {
    return;
  }

  var indices = textElement.getTextAttributeIndices();
  if (!indices.length || indices[0] !== 0) {
    indices = [0].concat(indices);
  }

  var current = null;
  for (var i = 0; i < indices.length; i++) {
    var start = indices[i];
    var end = (i + 1 < indices.length ? indices[i + 1] : text.length) - 1;
    if (end < start) {
      continue;
    }
    if (end >= text.length) {
      end = text.length - 1;
    }

    var url = linkUrlAtOffset_(textElement, start, end);
    var meta = parseCitationUrl_(url);
    if (!meta) {
      current = null;
      continue;
    }

    // Ten sam link rozbity zmianą formatowania (np. pogrubienie) to wciąż jedno cytowanie.
    if (current && current.url === url && current.end === start - 1) {
      current.end = end;
      continue;
    }

    current = {
      textElement: textElement,
      start: start,
      end: end,
      url: url,
      item_key: meta.itemKey,
      citation_id: meta.citationId,
      display_title: meta.displayTitle || '',
    };
    runs.push(current);
  }
}

function uniqueItemKeys_(runs) {
  var seen = {};
  var keys = [];
  for (var i = 0; i < runs.length; i++) {
    var key = normalizeItemKey_(runs[i].item_key);
    if (!key || seen[key]) {
      continue;
    }
    seen[key] = true;
    keys.push(key);
  }
  return keys;
}

function citationRunText_(textElement, start, end) {
  var text = textElement.getText();
  var slice = text.substring(start, end + 1);
  return slice.replace(/\n+$/g, '').trim();
}

/**
 * Sąsiednie kotwice (nic / spacje / przecinki / myślniki między nimi) traktujemy
 * jako jedną grupę — przy stylach numerycznych składamy je do [1,2], przy innych
 * rozbijamy z powrotem na osobne cytowania obok siebie.
 */
function groupAdjacentCitationRuns_(runs) {
  var groups = [];
  var current = null;
  for (var i = 0; i < runs.length; i++) {
    var run = runs[i];
    if (!current) {
      current = [run];
      continue;
    }
    var prev = current[current.length - 1];
    if (citationRunsAreAdjacent_(prev, run)) {
      current.push(run);
    } else {
      groups.push(current);
      current = [run];
    }
  }
  if (current) {
    groups.push(current);
  }
  return groups;
}

function citationRunsAreAdjacent_(a, b) {
  if (!a || !b || a.textElement !== b.textElement) {
    return false;
  }
  if (b.start <= a.end) {
    return false;
  }
  var gap = a.textElement.getText().substring(a.end + 1, b.start);
  return /^[\s,]*$/.test(gap) || /^[\s]*[-–—][\s]*$/.test(gap);
}

/** Dla formy [1,2] (linki tylko na cyfrach) rozszerza zakres o zewnętrzne nawiasy. */
function citationGroupReplaceBounds_(group) {
  var te = group[0].textElement;
  var text = te.getText();
  var start = group[0].start;
  var end = group[group.length - 1].end;
  var allDigits = true;
  for (var i = 0; i < group.length; i++) {
    var slice = text.substring(group[i].start, group[i].end + 1);
    if (!/^\d+$/.test(slice)) {
      allDigits = false;
      break;
    }
  }
  if (
    allDigits &&
    start > 0 &&
    text.charAt(start - 1) === '[' &&
    end + 1 < text.length &&
    text.charAt(end + 1) === ']'
  ) {
    start -= 1;
    end += 1;
  }
  return { textElement: te, start: start, end: end };
}

function extractNumericCitationNumber_(text) {
  var match = /^\[(\d+)\]$/.exec(String(text || '').trim());
  return match ? parseInt(match[1], 10) : null;
}

function buildCitationGroupMembers_(group, citationByKey, titleByKey) {
  var members = [];
  var seen = {};
  for (var i = 0; i < group.length; i++) {
    var itemKey = normalizeItemKey_(group[i].item_key);
    var newText = citationByKey[itemKey];
    if (!itemKey || !newText) {
      continue;
    }
    if (seen[itemKey]) {
      continue;
    }
    seen[itemKey] = true;
    members.push({
      itemKey: itemKey,
      citationId: group[i].citation_id,
      citationText: newText,
      hoverTitle: citationHoverTitle_(
        newText,
        titleByKey[itemKey] || '',
        group[i].display_title || ''
      ),
      number: extractNumericCitationNumber_(newText),
    });
  }
  return members;
}

/**
 * Podmienia tekst cytowań na nowy. Idzie od końca dokumentu, bo każda zmiana
 * długości tekstu przesuwa offsety kolejnych cytowań w tym samym akapicie.
 *
 * Przy numeric=true sąsiednie [1][2] składane są do [1,2] z osobnymi linkami
 * na cyfrach (nawiasy i przecinki bez kotwicy). Zakresów [1-3] nie robimy —
 * środkowa pozycja zniknęłaby z dokumentu i skaner by ją zgubił.
 */
function rewriteCitationRuns_(runs, citationByKey, titleByKey, numeric) {
  var updated = 0;
  var unchanged = 0;
  var skipped = 0;
  var collapsed = 0;
  var normalizedMap = {};
  var normalizedTitles = {};
  Object.keys(citationByKey || {}).forEach(function (k) {
    normalizedMap[normalizeItemKey_(k)] = citationByKey[k];
  });
  Object.keys(titleByKey || {}).forEach(function (k) {
    normalizedTitles[normalizeItemKey_(k)] = titleByKey[k];
  });

  var groups = groupAdjacentCitationRuns_(runs);
  for (var g = groups.length - 1; g >= 0; g--) {
    var group = groups[g];
    var members = buildCitationGroupMembers_(group, normalizedMap, normalizedTitles);
    if (!members.length) {
      skipped += group.length;
      continue;
    }

    var result;
    if (numeric && members.length > 1 && members.every(function (m) { return m.number !== null; })) {
      result = writeCollapsedNumericCitationGroup_(group, members);
      if (result.collapsed) {
        collapsed++;
      }
    } else if (numeric && members.length === 1 && members[0].number !== null) {
      result = writeSingleCitationRun_(group, members[0]);
    } else {
      result = writeExpandedCitationGroup_(group, members);
    }

    updated += result.updated || 0;
    unchanged += result.unchanged || 0;
    skipped += result.skipped || 0;
  }

  return {
    updated: updated,
    unchanged: unchanged,
    skipped: skipped,
    collapsed: collapsed,
  };
}

function writeSingleCitationRun_(group, member) {
  var bounds = citationGroupReplaceBounds_(group);
  var te = bounds.textElement;
  var newText = member.citationText;
  var currentText = te.getText().substring(bounds.start, bounds.end + 1);
  if (currentText !== newText) {
    te.deleteText(bounds.start, bounds.end);
    te.insertText(bounds.start, newText);
    applyCitationLink_(
      te,
      bounds.start,
      bounds.start + newText.length - 1,
      member.itemKey,
      member.citationId,
      member.hoverTitle
    );
    return { updated: 1 };
  }
  var nextUrl = buildCitationUrl_(member.itemKey, member.citationId, member.hoverTitle);
  var url = linkUrlAtOffset_(te, bounds.start, bounds.end);
  if (nextUrl !== url) {
    applyCitationLink_(
      te,
      bounds.start,
      bounds.end,
      member.itemKey,
      member.citationId,
      member.hoverTitle
    );
  }
  return { unchanged: 1 };
}

/** Osobne pełne cytowania obok siebie — styl autor–rok albo pojedyncze numery. */
function writeExpandedCitationGroup_(group, members) {
  var bounds = citationGroupReplaceBounds_(group);
  var te = bounds.textElement;
  var built = '';
  var spans = [];
  for (var i = 0; i < members.length; i++) {
    var start = built.length;
    built += members[i].citationText;
    spans.push({
      start: start,
      end: built.length - 1,
      member: members[i],
    });
  }
  var currentText = te.getText().substring(bounds.start, bounds.end + 1);
  if (currentText === built) {
    for (var u = 0; u < spans.length; u++) {
      applyCitationLink_(
        te,
        bounds.start + spans[u].start,
        bounds.start + spans[u].end,
        spans[u].member.itemKey,
        spans[u].member.citationId,
        spans[u].member.hoverTitle
      );
    }
    return { unchanged: members.length };
  }
  te.deleteText(bounds.start, bounds.end);
  te.insertText(bounds.start, built);
  te.setLinkUrl(bounds.start, bounds.start + built.length - 1, null);
  for (var s = 0; s < spans.length; s++) {
    applyCitationLink_(
      te,
      bounds.start + spans[s].start,
      bounds.start + spans[s].end,
      spans[s].member.itemKey,
      spans[s].member.citationId,
      spans[s].member.hoverTitle
    );
  }
  return { updated: members.length };
}

/**
 * [1][2] / [1], [2] / wcześniej złożone [1,2] → jeden napis [1,2]
 * z kotwicami tylko na cyfrach (opcja d).
 */
function writeCollapsedNumericCitationGroup_(group, members) {
  members = members.slice().sort(function (a, b) {
    return a.number - b.number;
  });
  var built = '[';
  var spans = [];
  for (var i = 0; i < members.length; i++) {
    if (i > 0) {
      built += ',';
    }
    var numStr = String(members[i].number);
    spans.push({
      start: built.length,
      end: built.length + numStr.length - 1,
      member: members[i],
    });
    built += numStr;
  }
  built += ']';

  var bounds = citationGroupReplaceBounds_(group);
  var te = bounds.textElement;
  var currentText = te.getText().substring(bounds.start, bounds.end + 1);
  var textChanged = currentText !== built;
  if (textChanged) {
    te.deleteText(bounds.start, bounds.end);
    te.insertText(bounds.start, built);
  }
  te.setLinkUrl(bounds.start, bounds.start + built.length - 1, null);
  for (var s = 0; s < spans.length; s++) {
    applyCitationLink_(
      te,
      bounds.start + spans[s].start,
      bounds.start + spans[s].end,
      spans[s].member.itemKey,
      spans[s].member.citationId,
      spans[s].member.hoverTitle
    );
  }
  return textChanged
    ? { updated: members.length, collapsed: true }
    : { unchanged: members.length, collapsed: true };
}

/** Jednorazowo przenosi cytowania z NamedRange (wersja 1.x) na kotwice-linki. */
function migrateLegacyNamedRanges_() {
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty(PROP_LEGACY_MIGRATED) === 'true') {
    return 0;
  }

  var doc = DocumentApp.getActiveDocument();
  var entries = loadLegacyCitationRanges_();
  var migrated = 0;

  for (var i = 0; i < entries.length; i++) {
    var itemKey = String(entries[i].item_key || '').trim();
    var named = itemKey ? doc.getNamedRanges(entries[i].name) : [];
    for (var n = 0; n < named.length; n++) {
      try {
        var elements = named[n].getRange().getRangeElements();
        for (var e = 0; e < elements.length; e++) {
          var element = elements[e];
          if (element.getElement().getType() !== DocumentApp.ElementType.TEXT) {
            continue;
          }
          var textElement = element.getElement().asText();
          var start = element.isPartial() ? element.getStartOffset() : 0;
          var end = element.isPartial()
            ? element.getEndOffsetInclusive()
            : textElement.getText().length - 1;
          applyCitationLink_(textElement, start, end, itemKey, newCitationId_());
          migrated++;
        }
      } catch (err) {
        // Uszkodzony stary zakres pomijamy — link i tak jest źródłem prawdy.
      }
      named[n].remove();
    }
  }

  props.deleteProperty(PROP_CITATION_RANGES);
  props.setProperty(PROP_LEGACY_MIGRATED, 'true');
  return migrated;
}

function loadLegacyCitationRanges_() {
  var raw = PropertiesService.getDocumentProperties().getProperty(PROP_CITATION_RANGES) || '[]';
  try {
    var entries = JSON.parse(raw);
    return Array.isArray(entries) ? entries : [];
  } catch (e) {
    return [];
  }
}

function buildPlaceholderPatterns_(identifiers) {
  var patterns = ['[*]'];
  var type = String(identifiers.type || '').toLowerCase();
  var value = String(identifiers.value || '').trim();

  if (type === 'doi' && value) {
    addDoiPlaceholderPatterns_(patterns, value);
  } else if (type === 'orcid' && value) {
    patterns.push('[orcid]', '[ORCID]', '[' + value + ']');
  } else if (type === 'pmid' && value) {
    patterns.push('[pmid]', '[PMID]', '[' + value + ']');
  } else if (value) {
    var maybeDoi = normalizeDoiIdentifier_(value);
    if (maybeDoi) {
      addDoiPlaceholderPatterns_(patterns, maybeDoi);
    } else {
      patterns.push('[' + value + ']');
    }
  }

  if (identifiers.extra && identifiers.extra.length) {
    for (var j = 0; j < identifiers.extra.length; j++) {
      var extra = String(identifiers.extra[j] || '').trim();
      if (!extra) continue;
      var extraDoi = normalizeDoiIdentifier_(extra);
      if (extraDoi) {
        addDoiPlaceholderPatterns_(patterns, extraDoi);
      } else {
        pushUniquePattern_(patterns, '[' + extra + ']');
      }
    }
  }

  return patterns;
}

function addDoiPlaceholderPatterns_(patterns, rawValue) {
  var doi = normalizeDoiIdentifier_(rawValue);
  if (!doi) return;
  pushUniquePattern_(patterns, '[doi]');
  pushUniquePattern_(patterns, '[DOI]');
  pushUniquePattern_(patterns, '[' + doi + ']');
  pushUniquePattern_(patterns, '[doi:' + doi + ']');
  pushUniquePattern_(patterns, '[DOI:' + doi + ']');
  var raw = String(rawValue || '').trim();
  if (raw && raw.toLowerCase() !== doi.toLowerCase()) {
    pushUniquePattern_(patterns, '[' + raw + ']');
    pushUniquePattern_(patterns, '[doi:' + raw + ']');
    pushUniquePattern_(patterns, '[DOI:' + raw + ']');
  }
}

function pushUniquePattern_(patterns, pattern) {
  if (!pattern || patterns.indexOf(pattern) >= 0) return;
  patterns.push(pattern);
}

function normalizeDoiIdentifier_(value) {
  var v = String(value || '').trim();
  if (!v) return '';
  v = v.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  v = v.replace(/^doi:\s*/i, '');
  return v.trim();
}

function enrichIdentifiersForPlaceholder_(identifiers, itemKey) {
  identifiers = identifiers || {};
  var type = String(identifiers.type || '').toLowerCase();
  var value = String(identifiers.value || '').trim();
  if (type === 'doi' && value) {
    return { type: 'doi', value: normalizeDoiIdentifier_(value) || value, extra: identifiers.extra };
  }
  if (!type && value) {
    var inferred = normalizeDoiIdentifier_(value);
    if (inferred) {
      return { type: 'doi', value: inferred, extra: identifiers.extra };
    }
    return identifiers;
  }
  var key = normalizeItemKey_(itemKey);
  if (!key) return identifiers;
  try {
    var data = apiGet('/items/' + encodeURIComponent(key));
    var doi = normalizeDoiIdentifier_(data.doi || (data.item && data.item.doi) || '');
    if (doi) {
      return { type: 'doi', value: doi, extra: identifiers.extra };
    }
  } catch (e) {
    // Brak DOI w metadanych — zostaw identyfikatory bez zmian.
  }
  return identifiers;
}

function buildIdentifiers_(type, value) {
  var normalized = String(type || '').toLowerCase() === 'doi'
    ? normalizeDoiIdentifier_(value)
    : String(value || '').trim();
  return { type: type, value: normalized || String(value || '').trim() };
}

function replaceFirstLiteral_(element, searchText, replacementText) {
  var escaped = escapeRegexLiteral_(searchText);
  var found = element.findText(escaped);
  if (!found) {
    return false;
  }
  // findText() zwraca RangeElement, nie Text — trzeba edytować element tekstowy.
  var textElement = found.getElement().asText();
  var start = found.getStartOffset();
  var end = found.getEndOffsetInclusive();
  textElement.deleteText(start, end);
  textElement.insertText(start, replacementText);
  return {
    textElement: textElement,
    start: start,
    end: start + replacementText.length - 1,
  };
}

function escapeRegexLiteral_(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCitationText_(item) {
  if (!item) return '(?)';
  if (item.citation_text) return item.citation_text;

  var creators = item.creators || [];
  var date = String(item.date || '');
  var year = date.length >= 4 && /^\d{4}/.test(date) ? date.substring(0, 4) : '';
  var author = '';
  if (creators.length) {
    var c = creators[0];
    author = c.lastName || c.name || c.firstName || '';
  }
  if (author && year) return '(' + author + ', ' + year + ')';
  if (author) return '(' + author + ')';
  var title = String(item.title || '').trim();
  if (title) {
    return '(' + (title.length > 60 ? title.substring(0, 60) + '…' : title) + ')';
  }
  return '(?)';
}

function rememberSessionItem_(importResult, itemKey, citationText) {
  if (!itemKey) return;
  var props = PropertiesService.getDocumentProperties();
  var raw = props.getProperty('sessionItems') || '[]';
  var items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    items = [];
  }
  if (!Array.isArray(items)) items = [];

  var entry = {
    key: itemKey,
    doi: importResult.doi || '',
    title: importResult.title || (importResult.existing && importResult.existing.title) || '',
    citation_text: citationText || importResult.citation_text || '',
    at: new Date().toISOString(),
  };
  items = items.filter(function (it) { return it.key !== itemKey; });
  items.unshift(entry);
  if (items.length > 30) items = items.slice(0, 30);
  props.setProperty('sessionItems', JSON.stringify(items));
}

function getSessionItems() {
  var raw = PropertiesService.getDocumentProperties().getProperty('sessionItems') || '[]';
  try {
    var items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch (e) {
    return [];
  }
}

function getLastStatus() {
  return PropertiesService.getDocumentProperties().getProperty('lastImport') || '';
}

/**
 * Wyciąga klucz pozycji Zotero z odpowiedzi add-item-by-id / Local API.
 * Używane przez sidebar do komunikatu z Connectorem (postMessage).
 */
function extractItemKey(result) {
  return extractItemKey_(result);
}

function extractItemKey_(result) {
  if (!result || typeof result !== 'object') {
    return '';
  }
  if (result.key) {
    return String(result.key);
  }
  if (result.itemKey) {
    return String(result.itemKey);
  }

  var nested = result.result;
  if (!nested || typeof nested !== 'object') {
    return '';
  }
  if (nested.key) {
    return String(nested.key);
  }
  if (nested.itemKey) {
    return String(nested.itemKey);
  }
  if (nested.success && typeof nested.success === 'object') {
    var keys = Object.keys(nested.success);
    for (var i = 0; i < keys.length; i++) {
      var entry = nested.success[keys[i]];
      if (entry && entry.key) {
        return String(entry.key);
      }
    }
  }
  if (Array.isArray(nested) && nested.length && nested[0].key) {
    return String(nested[0].key);
  }
  return '';
}

function apiGet(path) {
  if (getDebugMode() && path.indexOf('debug=') < 0) {
    path += (path.indexOf('?') >= 0 ? '&' : '?') + 'debug=1';
  }
  const response = UrlFetchApp.fetch(API_BASE + path, {
    method: 'get',
    muteHttpExceptions: true,
    headers: apiHeaders_(),
  });
  return parseResponse_(response);
}

function apiPost(path, payload) {
  if (getDebugMode() && path.indexOf('debug=') < 0) {
    path += (path.indexOf('?') >= 0 ? '&' : '?') + 'debug=1';
  }
  const response = UrlFetchApp.fetch(API_BASE + path, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: apiHeaders_(),
  });
  const parsed = parseResponse_(response);
  PropertiesService.getDocumentProperties().setProperty(
    'lastImport',
    JSON.stringify({ at: new Date().toISOString(), path: path, result: parsed })
  );
  return parsed;
}

function apiDelete(path) {
  if (getDebugMode() && path.indexOf('debug=') < 0) {
    path += (path.indexOf('?') >= 0 ? '&' : '?') + 'debug=1';
  }
  const response = UrlFetchApp.fetch(API_BASE + path, {
    method: 'delete',
    muteHttpExceptions: true,
    headers: apiHeaders_(),
  });
  return parseResponse_(response);
}

function apiHeaders_() {
  const props = PropertiesService.getScriptProperties();
  const headers = { 'Accept': 'application/json' };
  const apiKey = props.getProperty('ZOTERO20_API_KEY');
  if (!apiKey) {
    throw new Error('Ustaw ZOTERO20_API_KEY w Script Properties.');
  }
  headers['X-API-Key'] = apiKey;
  return headers;
}

function parseResponse_(response) {
  const code = response.getResponseCode();
  const text = response.getContentText();
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    body = { raw: text };
  }
  if (code >= 400) {
    var detail = body.error || body.detail;
    if (!detail && body.raw) {
      detail = String(body.raw).substring(0, 300);
    }
    var message = detail || ('HTTP ' + code);
    if (getDebugMode()) {
      message +=
        '\n[debug] HTTP ' +
        code +
        '\n' +
        String(text).substring(0, 1200);
    }
    throw new Error(message);
  }
  return body;
}
