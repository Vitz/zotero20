/**
 * Zotero20 — panel importu ORCID/DOI (jeden host + klucz API)
 * Base: https://zotero.keyweb.pl
 */

const API_BASE = 'https://zotero.keyweb.pl/api/v1';
// Podbij przy każdej zmianie Code.gs — sidebar porównuje wersje i ostrzega przy niezgodności.
const ADDON_VERSION = '2.3.4';
const PROP_DEFAULT_COLLECTION_KEY = 'ZOTERO20_DEFAULT_COLLECTION_KEY';
const PROP_DEFAULT_COLLECTION_NAME = 'ZOTERO20_DEFAULT_COLLECTION_NAME';
const PROP_BIBLIOGRAPHY_STYLE = 'ZOTERO20_BIBLIOGRAPHY_STYLE';
const PROP_BIBLIOGRAPHY_CITED_ONLY = 'ZOTERO20_BIBLIOGRAPHY_CITED_ONLY';
const PROP_BIBLIOGRAPHY_FONT = 'ZOTERO20_BIBLIOGRAPHY_FONT';
const PROP_BIBLIOGRAPHY_FONT_SIZE = 'ZOTERO20_BIBLIOGRAPHY_FONT_SIZE';
const PROP_CITATION_INSERT_MODE = 'ZOTERO20_CITATION_INSERT_MODE';
const PROP_CITATION_LOCALE = 'ZOTERO20_CITATION_LOCALE';
/** Pełne referencje w miejscu cytowania (dawniej błędnie: tryb [DOI]). */
const PROP_INLINE_FULL_REFERENCE = 'ZOTERO20_INLINE_FULL_REFERENCE';
/** Stary klucz — czytany tylko przy migracji. */
const PROP_INLINE_DOI_MODE_LEGACY = 'ZOTERO20_INLINE_DOI_MODE';
const PROP_SKIP_END_BIBLIOGRAPHY = 'ZOTERO20_SKIP_END_BIBLIOGRAPHY';
const PROP_DEBUG = 'ZOTERO20_DEBUG';
/** Klucz do API zotero.keyweb.pl — zapisywany z panelu Docs (Ustawienia). */
const PROP_ZOTERO20_API_KEY = 'ZOTERO20_API_KEY';
const PROP_GEMINI_API_KEY = 'ZOTERO20_GEMINI_API_KEY';
const PROP_DEEPL_API_KEY = 'ZOTERO20_DEEPL_API_KEY';
const PROP_DEEPL_PLAN = 'ZOTERO20_DEEPL_PLAN';
const PROP_DEEPL_CHAIN = 'ZOTERO20_DEEPL_CHAIN';
const PROP_DEEPL_OPTIONS = 'ZOTERO20_DEEPL_OPTIONS';
const PROP_DEEPL_WRITE_OPTIONS = 'ZOTERO20_DEEPL_WRITE_OPTIONS';
const DEEPL_FREE_BASE = 'https://api-free.deepl.com';
const DEEPL_PRO_BASE = 'https://api.deepl.com';
const DEEPL_MAX_TEXT_LENGTH = 50000;
const DEEPL_MAX_CHAIN_STEPS = 8;
const DEEPL_WRITE_MAX_BYTES = 10000;
/** Języki DeepL Write (API nie wspiera PL). */
const DEEPL_WRITE_LANGS_ = [
  { language: 'de', name: 'German' },
  { language: 'en-GB', name: 'English (British)' },
  { language: 'en-US', name: 'English (American)' },
  { language: 'es', name: 'Spanish' },
  { language: 'fr', name: 'French' },
  { language: 'it', name: 'Italian' },
  { language: 'ja', name: 'Japanese' },
  { language: 'ko', name: 'Korean' },
  { language: 'pt-BR', name: 'Portuguese (Brazilian)' },
  { language: 'pt-PT', name: 'Portuguese (European)' },
  { language: 'zh', name: 'Chinese (simplified)' },
];
// Gemini REST — wywołanie z Apps Script (UrlFetch), bez Django/Cloudflare.
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_MAX_TEXT_LENGTH = 12000;
const GEMINI_SYSTEM_PROMPT =
  'Jesteś asystentem bibliograficznym. Na podstawie podanego tekstu wypełnij ' +
  'metadane pozycji w formacie Zotero (JSON). ' +
  'Wypełniaj TYLKO pola, które wynikają wprost z tekstu. ' +
  'NIE wymyślaj DOI, ISBN ani URL — jeśli nie ma ich w tekście, zostaw puste. ' +
  'Nie zmieniaj itemType na inny niż podany. ' +
  'Nieznane wartości = pusty string. Autorów rozbij na firstName/lastName gdy to możliwe.';
const MANUAL_ITEM_TYPE_FIELDS = {
  preprint: ['repository', 'archiveID', 'archive', 'libraryCatalog', 'callNumber'],
  journalArticle: [
    'publicationTitle',
    'volume',
    'issue',
    'pages',
    'series',
    'seriesTitle',
    'seriesText',
    'journalAbbreviation',
    'ISSN',
  ],
  book: [
    'publisher',
    'place',
    'ISBN',
    'numPages',
    'edition',
    'volume',
    'series',
    'seriesNumber',
  ],
  bookSection: [
    'bookTitle',
    'publisher',
    'place',
    'ISBN',
    'pages',
    'edition',
    'series',
    'seriesNumber',
    'volume',
  ],
  thesis: ['university', 'place', 'thesisType', 'numPages'],
  report: ['institution', 'reportNumber', 'place', 'pages', 'seriesTitle', 'seriesNumber'],
  webpage: ['websiteTitle', 'websiteType'],
};
const MANUAL_COMMON_FIELDS = [
  'title',
  'creators',
  'date',
  'url',
  'abstractNote',
  'language',
  'extra',
  'DOI',
  'accessDate',
  'rights',
  'shortTitle',
];
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
  // Import DOI tylko dodaje do kolekcji — NIE zamienia [*] / placeholderów w dokumencie.
  // Cytowanie wstawia użytkownik osobno (przycisk „Wstaw cytowanie” / lista).
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
 * Plan importu ORCID: lista DOI bez zapisu do Zotero.
 * Używane przez sidebar do chunkowanego importu z progressem.
 */
function planOrcidImport(orcid, limit) {
  return apiPost('/import/orcid/plan', {
    orcid: orcid,
    limit: limit || 50,
  });
}

/**
 * Import DOI z retry (3 próby). Nie rzuca przy porażce — zwraca { ok, result|error, retries }.
 */
function importDoiWithRetry(doi, options, maxAttempts) {
  var attempts = Math.max(1, Math.min(Number(maxAttempts) || 3, 5));
  var lastError = null;
  for (var i = 1; i <= attempts; i++) {
    try {
      var result = importDoi(doi, options);
      return { ok: true, result: result, retries: i, doi: doi };
    } catch (e) {
      lastError = e;
      if (i < attempts) {
        Utilities.sleep(400 * i);
      }
    }
  }
  return {
    ok: false,
    error: lastError ? String(lastError.message || lastError) : 'Nieznany błąd',
    retries: attempts,
    doi: doi,
  };
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
  // Import Inne / ręczny tylko dodaje do kolekcji — NIE zamienia [*] w dokumencie.
  if (itemKey) {
    rememberSessionItem_(result, itemKey, citationText);
  }
  result.item_key = itemKey || result.item_key || '';
  result.citation_text = citationText;
  return result;
}

/**
 * Gemini: tekst → draft pól (bez zapisu do Zotero).
 * Preferencja: bezpośredni UrlFetch do generativelanguage.googleapis.com
 * (omija Django/Cloudflare — CF Free ~100s i UrlFetch ~60s).
 * Fallback: POST /import/describe gdy brak klucza Gemini w panelu
 * albo gdy bezpośrednie wywołanie padnie sieciowo.
 * Zwraca { draft, warnings, model }.
 */
function describeManualItem(itemType, text) {
  var geminiKey = getGeminiApiKey();
  if (geminiKey) {
    try {
      var direct = describeWithGemini_(itemType, text, geminiKey);
      rememberDescribeResult_('gemini-direct', direct, true);
      return direct;
    } catch (directErr) {
      // Błędny klucz / walidacja — nie ma sensu iść na VPS z tym samym kluczem.
      var directMsg = String((directErr && directErr.message) || directErr || '');
      if (/brak klucza|za długi|wymagane pole|nieobsługiwany itemtype|http 40[013]/i.test(directMsg)) {
        throw directErr;
      }
      try {
        var viaServer = describeManualItemViaServer_(itemType, text, geminiKey);
        rememberDescribeResult_('gemini-server-fallback', viaServer, true);
        return viaServer;
      } catch (serverErr) {
        // Preferuj komunikat z bezpośredniego Gemini (bez HTML Cloudflare).
        throw directErr;
      }
    }
  }
  // Brak klucza w panelu — spróbuj opcjonalnego GEMINI_API_KEY na serwerze.
  var serverOnly = describeManualItemViaServer_(itemType, text, '');
  rememberDescribeResult_('gemini-server', serverOnly, false);
  return serverOnly;
}

/**
 * Bezpośrednie wywołanie Gemini REST (Apps Script → Google).
 * Klucz Gemini z panelu Docs — nigdy nie loguj wartości.
 */
function describeWithGemini_(itemType, text, apiKey) {
  itemType = String(itemType || '').trim();
  text = String(text || '').trim();
  apiKey = String(apiKey || '').trim();
  if (!apiKey) {
    throw new Error('Brak klucza Gemini — wklej go w Ustawieniach panelu Docs');
  }
  if (!text) {
    throw new Error('Wymagane pole: text.');
  }
  if (text.length > GEMINI_MAX_TEXT_LENGTH) {
    throw new Error('Tekst jest za długi (max ' + GEMINI_MAX_TEXT_LENGTH + ' znaków).');
  }
  if (!MANUAL_ITEM_TYPE_FIELDS[itemType]) {
    throw new Error('Nieobsługiwany itemType: ' + (itemType || '(brak)') + '.');
  }

  var model = GEMINI_DEFAULT_MODEL;
  var url =
    GEMINI_API_BASE +
    '/models/' +
    encodeURIComponent(model) +
    ':generateContent?key=' +
    encodeURIComponent(apiKey);
  var userPrompt =
    'itemType: ' +
    itemType +
    '\n\nTekst źródłowy:\n---\n' +
    text +
    '\n---\nZwróć jeden obiekt JSON z polami pozycji Zotero.';
  var body = {
    systemInstruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: geminiResponseSchema_(itemType),
    },
  };

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
      headers: { Accept: 'application/json' },
    });
  } catch (fetchErr) {
    throw new Error(
      'Błąd połączenia z Gemini: ' + String((fetchErr && fetchErr.message) || fetchErr)
    );
  }

  var code = response.getResponseCode();
  var rawText = response.getContentText() || '';
  if (code === 429) {
    throw new Error('Gemini zwróciło limit zapytań (429). Spróbuj później.');
  }
  if (code >= 400) {
    var friendly = humanizeHttpError_(code, rawText);
    if (friendly) {
      throw new Error(friendly);
    }
    throw new Error(
      'Gemini API błąd HTTP ' + code + ': ' + String(rawText).substring(0, 280)
    );
  }

  var payload;
  try {
    payload = JSON.parse(rawText);
  } catch (parseErr) {
    throw new Error('Nieprawidłowa odpowiedź Gemini (nie-JSON).');
  }

  var draftRawText = extractGeminiText_(payload);
  if (!draftRawText) {
    throw new Error('Gemini nie zwróciło treści.');
  }
  var draftRaw;
  try {
    draftRaw = JSON.parse(draftRawText);
  } catch (jsonErr) {
    throw new Error('Gemini zwróciło nieparsowalny JSON.');
  }
  if (!draftRaw || typeof draftRaw !== 'object' || Array.isArray(draftRaw)) {
    throw new Error('Draft Gemini nie jest obiektem JSON.');
  }

  var normalized = normalizeGeminiDraft_(itemType, draftRaw);
  return {
    draft: normalized.draft,
    warnings: normalized.warnings,
    model: model,
    source: 'apps-script-direct',
  };
}

/** Fallback przez Django /import/describe (gdy brak lokalnego klucza lub awaria direct). */
function describeManualItemViaServer_(itemType, text, geminiKey) {
  var path = '/import/describe';
  if (getDebugMode()) {
    path += '?debug=1';
  }
  var headers = apiHeaders_();
  var payload = {
    item_type: String(itemType || '').trim(),
    text: String(text || ''),
  };
  if (geminiKey) {
    headers['X-Gemini-Api-Key'] = geminiKey;
    payload.gemini_api_key = geminiKey;
  }
  var response = UrlFetchApp.fetch(API_BASE + path, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: headers,
  });
  var parsed = parseResponse_(response);
  if (parsed && !parsed.source) {
    parsed.source = 'django-server';
  }
  return parsed;
}

function rememberDescribeResult_(pathLabel, parsed, geminiKeySent) {
  PropertiesService.getDocumentProperties().setProperty(
    'lastImport',
    JSON.stringify({
      at: new Date().toISOString(),
      path: pathLabel,
      result: {
        model: parsed && parsed.model,
        warnings: parsed && parsed.warnings,
        draft_title: parsed && parsed.draft && parsed.draft.title,
        source: parsed && parsed.source,
        gemini_key_sent: !!geminiKeySent,
      },
    })
  );
}

function geminiResponseSchema_(itemType) {
  var fields = MANUAL_COMMON_FIELDS.concat(MANUAL_ITEM_TYPE_FIELDS[itemType] || []);
  var properties = {
    itemType: { type: 'STRING' },
    creators: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          creatorType: { type: 'STRING' },
          firstName: { type: 'STRING' },
          lastName: { type: 'STRING' },
          name: { type: 'STRING' },
        },
      },
    },
  };
  fields.forEach(function (field) {
    if (field === 'creators') return;
    properties[field] = { type: 'STRING' };
  });
  var ordering = ['itemType', 'title', 'creators', 'date', 'url', 'abstractNote'];
  Object.keys(properties)
    .sort()
    .forEach(function (key) {
      if (ordering.indexOf(key) < 0) ordering.push(key);
    });
  return {
    type: 'OBJECT',
    properties: properties,
    propertyOrdering: ordering,
  };
}

function extractGeminiText_(payload) {
  var candidates = (payload && payload.candidates) || [];
  if (!candidates.length) return '';
  var content = candidates[0].content || {};
  var parts = content.parts || [];
  var chunks = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] && parts[i].text) {
      chunks.push(String(parts[i].text));
    }
  }
  return chunks.join('').trim();
}

function normalizeGeminiDraft_(itemType, draftRaw) {
  var allowed = {};
  MANUAL_COMMON_FIELDS.concat(MANUAL_ITEM_TYPE_FIELDS[itemType] || []).forEach(function (k) {
    allowed[k] = true;
  });
  var draft = { itemType: itemType };
  var warnings = [];
  Object.keys(draftRaw).forEach(function (key) {
    if (key === 'itemType' || key === 'collections' || key === 'collection_key') return;
    if (!allowed[key]) return;
    var value = draftRaw[key];
    if (key === 'creators') {
      if (!Array.isArray(value)) return;
      var creators = [];
      value.forEach(function (entry) {
        if (!entry || typeof entry !== 'object') return;
        var creatorType = String(entry.creatorType || 'author').trim() || 'author';
        var name = String(entry.name || '').trim();
        var first = String(entry.firstName || '').trim();
        var last = String(entry.lastName || '').trim();
        var out = { creatorType: creatorType };
        if (name) {
          out.name = name;
        } else if (first || last) {
          if (first) out.firstName = first;
          if (last) out.lastName = last;
        } else {
          return;
        }
        creators.push(out);
      });
      if (creators.length) draft.creators = creators;
      return;
    }
    if (value === null || value === undefined) return;
    var str = String(value).trim();
    if (!str) return;
    draft[key] = str;
  });
  if (!String(draft.title || '').trim()) {
    warnings.push('Brak tytułu w odpowiedzi modelu — uzupełnij ręcznie.');
  }
  return { draft: draft, warnings: warnings };
}

/** Klucz API zotero.keyweb.pl — ustawiany w panelu Docs (Ustawienia). */
function getZotero20ApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty(PROP_ZOTERO20_API_KEY);
  return key ? String(key).trim() : '';
}

function hasZotero20ApiKey() {
  return !!getZotero20ApiKey();
}

/**
 * Zapisuje klucz serwera Zotero20 z panelu Docs.
 * Pusty string usuwa klucz. Nie wymaga edytora Apps Script.
 */
function saveZotero20ApiKey(key) {
  key = String(key || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (!key) {
    props.deleteProperty(PROP_ZOTERO20_API_KEY);
    return { configured: false };
  }
  props.setProperty(PROP_ZOTERO20_API_KEY, key);
  return { configured: true };
}

/** Klucz Gemini — ustawiany w panelu Docs (Ustawienia). */
function getGeminiApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty(PROP_GEMINI_API_KEY);
  return key ? String(key).trim() : '';
}

/** Czy jest zapisany klucz Gemini (bez ujawniania wartości do HTML). */
function hasGeminiApiKey() {
  return !!getGeminiApiKey();
}

/**
 * Zapisuje klucz Gemini z panelu Docs.
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
 * Czy Gemini jest dostępne: klucz z Ustawień panelu
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
  // all=1: cała kolekcja (stronicowanie po stronie serwera); limit ignorowany.
  // Zachowaj limit dla wywołań jawnych (np. smoke / stare skrypty).
  if (limit === undefined || limit === null || limit === '' || Number(limit) <= 0) {
    return apiGet(
      '/collection-items?collection_key=' + encodeURIComponent(key) + '&all=1'
    );
  }
  var lim = Math.max(1, Math.min(Number(limit) || 20, 100));
  return apiGet(
    '/collection-items?collection_key=' +
      encodeURIComponent(key) +
      '&limit=' +
      lim
  );
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
  var apiKey = getZotero20ApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 'no_key',
      zotero: null,
      http: 0,
      checkedAt: checkedAt,
      error: 'Brak klucza API — wklej go w Ustawieniach panelu Docs.',
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

function getInlineFullReferenceMode() {
  var props = PropertiesService.getDocumentProperties();
  var current = props.getProperty(PROP_INLINE_FULL_REFERENCE);
  if (current === 'true' || current === 'false') {
    return current === 'true';
  }
  // Migracja ze starego (błędnego) trybu [DOI].
  return props.getProperty(PROP_INLINE_DOI_MODE_LEGACY) === 'true';
}

function saveInlineFullReferenceMode(enabled) {
  var props = PropertiesService.getDocumentProperties();
  props.setProperty(PROP_INLINE_FULL_REFERENCE, enabled ? 'true' : 'false');
  props.deleteProperty(PROP_INLINE_DOI_MODE_LEGACY);
  return getInlineFullReferenceMode();
}

/** Alias wsteczny dla starego sidebara — ten sam przełącznik. */
function getInlineDoiMode() {
  return getInlineFullReferenceMode();
}

function saveInlineDoiMode(enabled) {
  return saveInlineFullReferenceMode(enabled);
}

function getSkipEndBibliography() {
  return (
    PropertiesService.getDocumentProperties().getProperty(PROP_SKIP_END_BIBLIOGRAPHY) ===
    'true'
  );
}

function saveSkipEndBibliography(enabled) {
  PropertiesService.getDocumentProperties().setProperty(
    PROP_SKIP_END_BIBLIOGRAPHY,
    enabled ? 'true' : 'false'
  );
  return getSkipEndBibliography();
}

function extractDoiFromItemPayload_(data) {
  if (!data || typeof data !== 'object') {
    return '';
  }
  var direct =
    data.doi ||
    data.DOI ||
    (data.item && (data.item.doi || data.item.DOI)) ||
    '';
  return normalizeDoiIdentifier_(direct) || '';
}

function getItemDoi_(itemKey) {
  var key = normalizeItemKey_(itemKey);
  if (!key) {
    return '';
  }
  try {
    var data = apiGet('/items/' + encodeURIComponent(key));
    return extractDoiFromItemPayload_(data);
  } catch (e) {
    return '';
  }
}

/** Pełny wpis bibliograficzny pozycji (bez numeru [n] na początku). */
function getItemBibliographyText_(itemKey, style) {
  var key = normalizeItemKey_(itemKey);
  if (!key) {
    throw new Error('Brak klucza pozycji.');
  }
  var data = fetchDocumentCitations_([{ item_key: key }], style || getBibliographyStyle());
  var text =
    (data.bib_by_key && data.bib_by_key[key]) ||
    '';
  if (!text) {
    throw new Error('Brak pełnej referencji dla pozycji ' + key + '.');
  }
  return text;
}

function resolveCitationDisplayText_(itemKey, style, identifiers) {
  if (getInlineFullReferenceMode()) {
    return getItemBibliographyText_(itemKey, style);
  }
  return getItemCitationText(itemKey, style);
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
  var inlineFull = getInlineFullReferenceMode();
  var doiByKey = collectDoiByItemKey_(citations, data.item_keys);
  if (inlineFull) {
    (data.item_keys || []).forEach(function (k) {
      var key = normalizeItemKey_(k);
      if (!key) {
        return;
      }
      var bib = (data.bib_by_key && data.bib_by_key[key]) || '';
      if (bib) {
        data.citation_by_key[key] = bib;
      }
    });
  }

  var updated = rewriteCitationRuns_(
    citations,
    data.citation_by_key,
    data.title_by_key,
    !!data.numeric && !inlineFull,
    doiByKey
  );

  var bibliography = null;
  var bibliographyError = '';
  var skipBib =
    options.skipBibliography ||
    getSkipEndBibliography() ||
    (inlineFull && options.createBibliography !== true);
  if (skipBib) {
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
    numeric: !!data.numeric && !inlineFull,
    inline_full_reference: inlineFull,
    inline_doi: inlineFull,
    skip_end_bibliography: getSkipEndBibliography(),
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
    inline_full_reference: getInlineFullReferenceMode(),
    inline_doi: getInlineFullReferenceMode(),
    skip_end_bibliography: getSkipEndBibliography(),
    citation_count: citations.length,
    item_count: keys.length,
    item_keys: keys,
    has_bibliography: hasBibliographySection_(),
    version: ADDON_VERSION,
  };
}

/** Mapa item_key → DOI z kotwic w dokumencie + uzupełnienie z API. */
function collectDoiByItemKey_(citations, itemKeys) {
  var map = {};
  for (var i = 0; i < (citations || []).length; i++) {
    var key = normalizeItemKey_(citations[i].item_key);
    var doi = normalizeDoiIdentifier_(citations[i].doi || '');
    if (key && doi && !map[key]) {
      map[key] = doi;
    }
  }
  var keys = itemKeys && itemKeys.length ? itemKeys : uniqueItemKeys_(citations || []);
  for (var k = 0; k < keys.length; k++) {
    var itemKey = normalizeItemKey_(keys[k]);
    if (!itemKey || map[itemKey]) {
      continue;
    }
    var fetched = getItemDoi_(itemKey);
    if (fetched) {
      map[itemKey] = fetched;
    }
  }
  return map;
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
  var bibByKey = {};
  var titleByKey = {};
  var list = data.citations || [];
  var orderedKeys = (data.item_keys || keys).map(normalizeItemKey_);
  var entries = normalizeEntries_(data.entries);
  if (data.bib_by_key && typeof data.bib_by_key === 'object') {
    Object.keys(data.bib_by_key).forEach(function (rawKey) {
      var k = normalizeItemKey_(rawKey);
      var bib = String(data.bib_by_key[rawKey] || '').trim();
      if (k && bib) {
        bibByKey[k] = stripLeadingBibNumber_(bib);
      }
    });
  }
  if (data.numeric) {
    for (var e = 0; e < orderedKeys.length; e++) {
      if (entries[e]) {
        var stripped = stripLeadingBibNumber_(entries[e]);
        titleByKey[orderedKeys[e]] = stripped;
        if (orderedKeys[e] && stripped && !bibByKey[orderedKeys[e]]) {
          bibByKey[orderedKeys[e]] = stripped;
        }
      }
    }
  }
  for (var i = 0; i < list.length; i++) {
    var text = String(list[i].citation_text || '').trim();
    var key = normalizeItemKey_(list[i].item_key);
    var bibText = String(list[i].bibliography_text || '').trim();
    if (key && text) {
      byKey[key] = text;
    }
    if (key && bibText && !bibByKey[key]) {
      bibByKey[key] = stripLeadingBibNumber_(bibText);
    }
    var fromCite = usefulHoverTitle_(text);
    if (key && fromCite) {
      titleByKey[key] = fromCite;
    }
    if (key && bibByKey[key] && !titleByKey[key]) {
      titleByKey[key] = usefulHoverTitle_(bibByKey[key]) || bibByKey[key];
    }
  }
  return {
    citation_by_key: byKey,
    bib_by_key: bibByKey,
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
    citationText = resolveCitationDisplayText_(key, style, identifiers || {});
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
  var doiForLink =
    (placeholderIds && placeholderIds.type === 'doi' && placeholderIds.value) ||
    (identifiers && identifiers.type === 'doi' && identifiers.value) ||
    '';
  doiForLink = normalizeDoiIdentifier_(doiForLink) || '';
  var placement =
    mode === 'placeholder'
      ? replacePlaceholderInDocument_(
          citationText,
          placeholderIds,
          key,
          hoverTitle,
          doiForLink
        )
      : insertCitationAtCursor_(citationText, key, hoverTitle, doiForLink);

  var result = {
    replaced: true,
    tracked: true,
    item_key: key,
    citation_text: citationText,
    mode: placement.mode,
    inline_full_reference: getInlineFullReferenceMode(),
    inline_doi: getInlineFullReferenceMode(),
  };

  try {
    var skipBib =
      getSkipEndBibliography() ||
      getInlineFullReferenceMode() ||
      !hasBibliographySection_();
    var restyled = applyCitationStyle('', { skipBibliography: skipBib });
    result.cited_count = restyled.cited_count;
    result.numeric = restyled.numeric;
    result.bibliography_refreshed = !!restyled.bibliography;
    if (restyled.inline_full_reference || restyled.inline_doi) {
      // Pełną referencję ustala resolveCitationDisplayText_ / rewrite — nie nadpisuj numerem.
    } else if (restyled.numeric) {
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
function replacePlaceholderInDocument_(text, identifiers, itemKey, hoverTitle, doi) {
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
          hoverTitle,
          doi
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
function insertCitationAtCursor_(text, itemKey, hoverTitle, doi) {
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
    hoverTitle,
    doi
  );
  return { mode: 'cursor', text: text, item_key: itemKey };
}

function newCitationId_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function buildCitationUrl_(itemKey, citationId, displayTitle, doi) {
  var url =
    CITE_LINK_BASE +
    encodeURIComponent(normalizeItemKey_(itemKey)) +
    '?c=' +
    encodeURIComponent(citationId || newCitationId_());
  var title = sanitizeCiteTitle_(displayTitle);
  if (title) {
    url += '&t=' + encodeURIComponent(title);
  }
  var normalizedDoi = normalizeDoiIdentifier_(doi);
  if (normalizedDoi) {
    url += '&d=' + encodeURIComponent(normalizedDoi);
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
  var doi = '';
  var doiMatch = /[?&]d=([^&#]*)/i.exec(String(url));
  if (doiMatch && doiMatch[1]) {
    try {
      doi = normalizeDoiIdentifier_(
        decodeURIComponent(String(doiMatch[1]).replace(/\+/g, ' '))
      );
    } catch (e) {
      doi = normalizeDoiIdentifier_(doiMatch[1]);
    }
  }
  return {
    itemKey: itemKey,
    citationId: citationId,
    displayTitle: displayTitle,
    doi: doi || '',
  };
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
function applyCitationLink_(textElement, start, end, itemKey, citationId, displayTitle, doi) {
  if (end < start) {
    return;
  }
  textElement.setLinkUrl(
    start,
    end,
    buildCitationUrl_(itemKey, citationId, displayTitle, doi)
  );
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
      doi: meta.doi || '',
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

function buildCitationGroupMembers_(group, citationByKey, titleByKey, doiByKey) {
  var members = [];
  var seen = {};
  doiByKey = doiByKey || {};
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
      doi: normalizeDoiIdentifier_(
        group[i].doi || doiByKey[itemKey] || ''
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
function rewriteCitationRuns_(runs, citationByKey, titleByKey, numeric, doiByKey) {
  var updated = 0;
  var unchanged = 0;
  var skipped = 0;
  var collapsed = 0;
  var normalizedMap = {};
  var normalizedTitles = {};
  var normalizedDois = {};
  Object.keys(citationByKey || {}).forEach(function (k) {
    normalizedMap[normalizeItemKey_(k)] = citationByKey[k];
  });
  Object.keys(titleByKey || {}).forEach(function (k) {
    normalizedTitles[normalizeItemKey_(k)] = titleByKey[k];
  });
  Object.keys(doiByKey || {}).forEach(function (k) {
    var dk = normalizeItemKey_(k);
    var dv = normalizeDoiIdentifier_(doiByKey[k]);
    if (dk && dv) {
      normalizedDois[dk] = dv;
    }
  });

  var groups = groupAdjacentCitationRuns_(runs);
  for (var g = groups.length - 1; g >= 0; g--) {
    var group = groups[g];
    var members = buildCitationGroupMembers_(
      group,
      normalizedMap,
      normalizedTitles,
      normalizedDois
    );
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
      member.hoverTitle,
      member.doi
    );
    return { updated: 1 };
  }
  var nextUrl = buildCitationUrl_(
    member.itemKey,
    member.citationId,
    member.hoverTitle,
    member.doi
  );
  var url = linkUrlAtOffset_(te, bounds.start, bounds.end);
  if (nextUrl !== url) {
    applyCitationLink_(
      te,
      bounds.start,
      bounds.end,
      member.itemKey,
      member.citationId,
      member.hoverTitle,
      member.doi
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
        spans[u].member.hoverTitle,
        spans[u].member.doi
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
      spans[s].member.hoverTitle,
      spans[s].member.doi
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
      spans[s].member.hoverTitle,
      spans[s].member.doi
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

// ---------------------------------------------------------------------------
// DeepL — wywołania bezpośrednie z Apps Script (UrlFetch), klucz z panelu Docs
// ---------------------------------------------------------------------------

function getDeepLApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty(PROP_DEEPL_API_KEY);
  return key ? String(key).trim() : '';
}

function hasDeepLApiKey() {
  return !!getDeepLApiKey();
}

function saveDeepLApiKey(key) {
  key = String(key || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (!key) {
    props.deleteProperty(PROP_DEEPL_API_KEY);
    return { configured: false };
  }
  props.setProperty(PROP_DEEPL_API_KEY, key);
  if (key.indexOf(':fx') >= 0) {
    props.setProperty(PROP_DEEPL_PLAN, 'free');
  }
  return { configured: true, plan: getDeepLPlan() };
}

function getDeepLPlan() {
  var plan = PropertiesService.getScriptProperties().getProperty(PROP_DEEPL_PLAN);
  if (plan === 'pro' || plan === 'free') {
    return plan;
  }
  var key = getDeepLApiKey();
  return key.indexOf(':fx') >= 0 ? 'free' : 'pro';
}

function saveDeepLPlan(plan) {
  plan = plan === 'pro' ? 'pro' : 'free';
  PropertiesService.getScriptProperties().setProperty(PROP_DEEPL_PLAN, plan);
  return getDeepLPlan();
}

function getDeepLBaseUrl_() {
  return getDeepLPlan() === 'pro' ? DEEPL_PRO_BASE : DEEPL_FREE_BASE;
}

function getDeepLChain() {
  var raw = PropertiesService.getDocumentProperties().getProperty(PROP_DEEPL_CHAIN);
  if (!raw) {
    return ['EN', 'PL'];
  }
  try {
    var parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed
        .map(function (x) {
          return String(x || '')
            .trim()
            .toUpperCase();
        })
        .filter(Boolean)
        .slice(0, DEEPL_MAX_CHAIN_STEPS);
    }
  } catch (ignore) {}
  return ['EN', 'PL'];
}

function saveDeepLChain(chain) {
  if (!Array.isArray(chain)) {
    throw new Error('Łańcuch tłumaczeń musi być listą kodów języków.');
  }
  var cleaned = [];
  for (var i = 0; i < chain.length && cleaned.length < DEEPL_MAX_CHAIN_STEPS; i++) {
    var code = String(chain[i] || '')
      .trim()
      .toUpperCase();
    if (code) {
      cleaned.push(code);
    }
  }
  if (!cleaned.length) {
    throw new Error('Dodaj przynajmniej jeden język docelowy w łańcuchu.');
  }
  PropertiesService.getDocumentProperties().setProperty(
    PROP_DEEPL_CHAIN,
    JSON.stringify(cleaned)
  );
  return cleaned;
}

function getDeepLOptions() {
  var defaults = {
    source_lang: '',
    formality: 'default',
    preserve_formatting: true,
    split_sentences: '1',
    tag_handling: '',
    context: '',
    model_type: '',
    glossary_id: '',
    show_billed_characters: true,
  };
  var raw = PropertiesService.getDocumentProperties().getProperty(PROP_DEEPL_OPTIONS);
  if (!raw) {
    return defaults;
  }
  try {
    var parsed = JSON.parse(raw) || {};
    Object.keys(defaults).forEach(function (k) {
      if (parsed[k] !== undefined && parsed[k] !== null) {
        defaults[k] = parsed[k];
      }
    });
  } catch (ignore) {}
  return defaults;
}

function saveDeepLOptions(options) {
  options = options || {};
  var current = getDeepLOptions();
  Object.keys(current).forEach(function (k) {
    if (options[k] !== undefined) {
      current[k] = options[k];
    }
  });
  PropertiesService.getDocumentProperties().setProperty(
    PROP_DEEPL_OPTIONS,
    JSON.stringify(current)
  );
  return current;
}

function getDeepLWriteOptions() {
  var defaults = {
    mode: 'rephrase', // rephrase | correct
    target_lang: 'en-US',
    writing_style: '',
    tone: '',
    apply_mode: 'suggest', // suggest | replace | preview
  };
  var raw = PropertiesService.getDocumentProperties().getProperty(PROP_DEEPL_WRITE_OPTIONS);
  if (!raw) {
    return defaults;
  }
  try {
    var parsed = JSON.parse(raw) || {};
    Object.keys(defaults).forEach(function (k) {
      if (parsed[k] !== undefined && parsed[k] !== null && parsed[k] !== '') {
        defaults[k] = parsed[k];
      } else if (parsed[k] === '') {
        defaults[k] = '';
      }
    });
  } catch (ignore) {}
  if (defaults.mode !== 'correct') {
    defaults.mode = 'rephrase';
  }
  if (defaults.apply_mode !== 'replace' && defaults.apply_mode !== 'preview') {
    defaults.apply_mode = 'suggest';
  }
  return defaults;
}

function saveDeepLWriteOptions(options) {
  options = options || {};
  var current = getDeepLWriteOptions();
  Object.keys(current).forEach(function (k) {
    if (options[k] !== undefined) {
      current[k] = options[k];
    }
  });
  if (current.mode !== 'correct') {
    current.mode = 'rephrase';
  }
  if (current.apply_mode !== 'replace' && current.apply_mode !== 'preview') {
    current.apply_mode = 'suggest';
  }
  // styl i ton są wzajemnie wykluczające (wymóg DeepL).
  if (current.writing_style && current.tone) {
    current.tone = '';
  }
  PropertiesService.getDocumentProperties().setProperty(
    PROP_DEEPL_WRITE_OPTIONS,
    JSON.stringify(current)
  );
  return current;
}

function getDeepLWriteLanguages() {
  return { languages: DEEPL_WRITE_LANGS_.slice(), from_api: false };
}

function getDeepLSettings() {
  return {
    configured: hasDeepLApiKey(),
    plan: getDeepLPlan(),
    chain: getDeepLChain(),
    options: getDeepLOptions(),
    write: getDeepLWriteOptions(),
    write_languages: DEEPL_WRITE_LANGS_.slice(),
  };
}

function deeplFetch_(path, method, payload) {
  var key = getDeepLApiKey();
  if (!key) {
    throw new Error('Brak klucza DeepL — ustaw go w zakładce DeepL.');
  }
  var url = getDeepLBaseUrl_() + path;
  var opts = {
    method: method || 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'DeepL-Auth-Key ' + key,
      Accept: 'application/json',
    },
  };
  if (payload !== undefined && payload !== null) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  var response = UrlFetchApp.fetch(url, opts);
  var code = response.getResponseCode();
  var text = response.getContentText() || '';
  var body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (ignore) {
    body = { raw: text.slice(0, 500) };
  }
  if (code >= 400) {
    var detail =
      (body && (body.message || body.error || body.detail)) ||
      text.slice(0, 400) ||
      'HTTP ' + code;
    if (code === 403) {
      detail =
        'DeepL odrzucił klucz (403). Sprawdź klucz i plan Free/Pro — Free wymaga api-free.deepl.com.';
    }
    throw new Error('DeepL API błąd HTTP ' + code + ': ' + detail);
  }
  return body;
}

/** Lista języków DeepL (source|target). Fallback lokalny gdy API niedostępne. */
function getDeepLLanguages(kind) {
  kind = kind === 'source' ? 'source' : 'target';
  try {
    if (hasDeepLApiKey()) {
      var data = deeplFetch_('/v2/languages?type=' + encodeURIComponent(kind), 'get', null);
      if (Array.isArray(data) && data.length) {
        return {
          source: kind === 'source' ? data : null,
          target: kind === 'target' ? data : null,
          languages: data,
          from_api: true,
        };
      }
    }
  } catch (e) {
    if (getDebugMode()) {
      // kontynuuj fallback
    }
  }
  return {
    languages: kind === 'source' ? DEEPL_SOURCE_FALLBACK_ : DEEPL_TARGET_FALLBACK_,
    from_api: false,
  };
}

function getDeepLUsage() {
  return deeplFetch_('/v2/usage', 'get', null);
}

/**
 * Tłumaczy zaznaczony tekst łańcuchem języków (A → B → C …).
 * options.chain opcjonalnie nadpisuje zapisany łańcuch; options.* — parametry DeepL.
 */
function translateSelectedTextWithDeepL(options) {
  options = options || {};
  var selected = getSelectedPlainText_();
  if (!selected.text) {
    throw new Error('Zaznacz tekst w dokumencie do tłumaczenia.');
  }
  if (selected.text.length > DEEPL_MAX_TEXT_LENGTH) {
    throw new Error(
      'Zaznaczenie jest za długie (' +
        selected.text.length +
        ' znaków). Limit: ' +
        DEEPL_MAX_TEXT_LENGTH +
        '.'
    );
  }

  if (options.chain) {
    saveDeepLChain(options.chain);
  }
  if (options.options) {
    saveDeepLOptions(options.options);
  }

  var chain = getDeepLChain();
  var opts = getDeepLOptions();
  if (options.source_lang !== undefined) {
    opts.source_lang = options.source_lang;
  }

  var result = translateTextChainDeepL_(selected.text, chain, opts);
  var applyMode = options.apply_mode || 'replace';
  var applied = applyTextToSelection_(selected, result.final_text, applyMode);

  return {
    original: selected.text,
    final_text: result.final_text,
    steps: result.steps,
    chain: chain,
    billed_characters: result.billed_characters,
    apply_mode: applied.apply_mode,
    applied: applied.applied,
  };
}

/** Tylko podgląd łańcucha — bez podmiany w dokumencie. */
function previewDeepLChain(text, chain, options) {
  text = String(text || '');
  if (!text.trim()) {
    throw new Error('Brak tekstu do podglądu.');
  }
  if (chain && chain.length) {
    saveDeepLChain(chain);
  }
  if (options) {
    saveDeepLOptions(options);
  }
  return translateTextChainDeepL_(text, getDeepLChain(), getDeepLOptions());
}

/** Podgląd łańcucha na zaznaczeniu — bez podmiany w dokumencie. */
function previewSelectedTextWithDeepL(options) {
  options = options || {};
  var selected = getSelectedPlainText_();
  if (options.chain) {
    saveDeepLChain(options.chain);
  }
  if (options.options) {
    saveDeepLOptions(options.options);
  }
  var opts = getDeepLOptions();
  if (options.source_lang !== undefined) {
    opts.source_lang = options.source_lang;
  }
  var result = translateTextChainDeepL_(selected.text, getDeepLChain(), opts);
  return {
    original: selected.text,
    final_text: result.final_text,
    steps: result.steps,
    chain: getDeepLChain(),
    billed_characters: result.billed_characters,
    preview_only: true,
  };
}

function translateTextChainDeepL_(text, chain, options) {
  if (!hasDeepLApiKey()) {
    throw new Error('Brak klucza DeepL — ustaw go w zakładce DeepL.');
  }
  chain = (chain || []).map(function (c) {
    return String(c || '')
      .trim()
      .toUpperCase();
  }).filter(Boolean);
  if (!chain.length) {
    throw new Error('Łańcuch tłumaczeń jest pusty.');
  }
  if (chain.length > DEEPL_MAX_CHAIN_STEPS) {
    throw new Error('Maks. ' + DEEPL_MAX_CHAIN_STEPS + ' kroków w łańcuchu.');
  }

  options = options || getDeepLOptions();
  var current = String(text);
  var steps = [];
  var billed = 0;
  var sourceLang = String(options.source_lang || '').trim().toUpperCase();

  for (var i = 0; i < chain.length; i++) {
    var target = chain[i];
    var payload = {
      text: [current],
      target_lang: target,
    };
    if (sourceLang) {
      payload.source_lang = sourceLang;
    }
    if (options.formality && options.formality !== 'default') {
      payload.formality = options.formality;
    }
    if (options.preserve_formatting === true || options.preserve_formatting === '1') {
      payload.preserve_formatting = true;
    } else if (options.preserve_formatting === false || options.preserve_formatting === '0') {
      payload.preserve_formatting = false;
    }
    if (options.split_sentences !== undefined && options.split_sentences !== '') {
      payload.split_sentences = String(options.split_sentences);
    }
    if (options.tag_handling) {
      payload.tag_handling = String(options.tag_handling);
    }
    if (options.context) {
      payload.context = String(options.context).slice(0, 2000);
    }
    if (options.model_type) {
      payload.model_type = String(options.model_type);
    }
    if (options.glossary_id) {
      payload.glossary_id = String(options.glossary_id).trim();
      if (!payload.source_lang) {
        throw new Error(
          'Przy glossary_id DeepL wymaga source_lang — ustaw język źródłowy (nie auto).'
        );
      }
    }
    if (options.show_billed_characters) {
      payload.show_billed_characters = true;
    }

    var body = deeplFetch_('/v2/translate', 'post', payload);
    var tr =
      body && body.translations && body.translations[0] ? body.translations[0] : null;
    if (!tr || tr.text === undefined) {
      throw new Error('DeepL nie zwrócił tłumaczenia w kroku ' + (i + 1) + ' → ' + target);
    }
    var out = String(tr.text);
    var detected = String(tr.detected_source_language || sourceLang || '');
    var stepBilled = Number(tr.billed_characters || 0) || current.length;
    billed += stepBilled;
    steps.push({
      step: i + 1,
      source_lang: detected || sourceLang || 'auto',
      target_lang: target,
      input: current,
      output: out,
      billed_characters: stepBilled,
    });
    current = out;
    // Kolejny krok: źródłem jest poprzedni język docelowy (lepsza jakość łańcucha).
    sourceLang = target.indexOf('-') > 0 ? target.split('-')[0] : target;
  }

  return {
    final_text: current,
    steps: steps,
    billed_characters: billed,
  };
}

function getSelectedPlainText_() {
  var doc = DocumentApp.getActiveDocument();
  var selection = doc.getSelection();
  if (!selection) {
    throw new Error('Zaznacz tekst w dokumencie (kursorem / myszą).');
  }
  var ranges = selection.getRangeElements();
  if (!ranges || !ranges.length) {
    throw new Error('Zaznaczenie jest puste.');
  }
  var parts = [];
  var slices = [];
  for (var i = 0; i < ranges.length; i++) {
    var re = ranges[i];
    var element = re.getElement();
    if (!element.editAsText) {
      continue;
    }
    var textEl = element.asText();
    var full = textEl.getText() || '';
    var start = re.isPartial() ? re.getStartOffset() : 0;
    var end = re.isPartial() ? re.getEndOffsetInclusive() : full.length - 1;
    if (end < start) {
      continue;
    }
    parts.push(full.substring(start, end + 1));
    slices.push({ textElement: textEl, start: start, end: end });
  }
  var text = parts.join('');
  if (!String(text).trim()) {
    throw new Error('Zaznaczony tekst jest pusty.');
  }
  return { text: text, slices: slices };
}

/**
 * Podmienia zaznaczenie: czyści wszystkie slice'y, wstawia wynik w pierwszym.
 * Prosty model — działa dla typowego zaznaczenia ciągłego.
 */
function replaceSelectedPlainText_(selected, newText) {
  newText = String(newText || '');
  var slices = selected.slices || [];
  if (!slices.length) {
    throw new Error('Brak zakresu tekstu do podmiany.');
  }
  // Od końca — nie przesuwamy offsetów wcześniejszych fragmentów.
  for (var i = slices.length - 1; i >= 1; i--) {
    var s = slices[i];
    if (s.end >= s.start) {
      s.textElement.deleteText(s.start, s.end);
    }
  }
  var first = slices[0];
  if (first.end >= first.start) {
    first.textElement.deleteText(first.start, first.end);
  }
  first.textElement.insertText(first.start, newText);
}

/**
 * apply_mode: replace | suggest | preview
 * suggest = natywna „Sugerowana zmiana” w Google Docs (do akceptacji/odrzucenia).
 */
function applyTextToSelection_(selected, newText, applyMode) {
  applyMode = applyMode === 'suggest' || applyMode === 'preview' ? applyMode : 'replace';
  newText = String(newText || '');
  if (applyMode === 'preview') {
    return { apply_mode: 'preview', applied: false };
  }
  if (selected.text === newText) {
    return { apply_mode: applyMode, applied: false, unchanged: true };
  }
  if (applyMode === 'suggest') {
    suggestReplaceSelectedText_(selected, newText);
    return { apply_mode: 'suggest', applied: true };
  }
  replaceSelectedPlainText_(selected, newText);
  return { apply_mode: 'replace', applied: true };
}

/**
 * DeepL Write: poprawa / przeredagowanie zaznaczenia (w obrębie jednego języka).
 * Domyślnie wstawia jako sugerowaną zmianę Docs (do potwierdzenia).
 */
function improveSelectedTextWithDeepL(options) {
  options = options || {};
  if (options.write) {
    saveDeepLWriteOptions(options.write);
  }
  var writeOpts = getDeepLWriteOptions();
  if (options.apply_mode) {
    writeOpts.apply_mode = options.apply_mode;
  }

  var selected = getSelectedPlainText_();
  if (selected.text.length > DEEPL_MAX_TEXT_LENGTH) {
    throw new Error(
      'Zaznaczenie jest za długie (' +
        selected.text.length +
        ' znaków). Limit: ' +
        DEEPL_MAX_TEXT_LENGTH +
        '.'
    );
  }
  var byteLen = Utilities.newBlob(selected.text).getBytes().length;
  if (byteLen > DEEPL_WRITE_MAX_BYTES) {
    throw new Error(
      'DeepL Write ma limit ~10 KiB na request (teraz ' + byteLen + ' B). Zaznacz krótszy fragment.'
    );
  }

  var improved = deeplWriteImprove_(selected.text, writeOpts);
  var applied = applyTextToSelection_(selected, improved.text, writeOpts.apply_mode);

  return {
    original: selected.text,
    final_text: improved.text,
    detected_source_language: improved.detected_source_language,
    target_language: improved.target_language,
    mode: writeOpts.mode,
    writing_style: writeOpts.writing_style || '',
    tone: writeOpts.tone || '',
    apply_mode: applied.apply_mode,
    applied: applied.applied,
    unchanged: !!applied.unchanged,
  };
}

function previewSelectedTextWithDeepLWrite(options) {
  options = options || {};
  if (options.write) {
    saveDeepLWriteOptions(options.write);
  }
  var writeOpts = getDeepLWriteOptions();
  writeOpts.apply_mode = 'preview';
  var selected = getSelectedPlainText_();
  var improved = deeplWriteImprove_(selected.text, writeOpts);
  return {
    original: selected.text,
    final_text: improved.text,
    detected_source_language: improved.detected_source_language,
    target_language: improved.target_language,
    mode: writeOpts.mode,
    writing_style: writeOpts.writing_style || '',
    tone: writeOpts.tone || '',
    apply_mode: 'preview',
    applied: false,
    preview_only: true,
  };
}

function deeplWriteImprove_(text, writeOpts) {
  if (!hasDeepLApiKey()) {
    throw new Error('Brak klucza DeepL — ustaw go w zakładce DeepL.');
  }
  if (getDeepLPlan() === 'free') {
    throw new Error(
      'DeepL Write wymaga planu API Pro (api.deepl.com). Free (:fx) obsługuje tylko tłumaczenie.'
    );
  }
  writeOpts = writeOpts || getDeepLWriteOptions();
  var target = String(writeOpts.target_lang || 'en-US').trim();
  if (!target) {
    throw new Error('Wybierz język DeepL Write (API nie wspiera PL).');
  }
  var supported = false;
  for (var i = 0; i < DEEPL_WRITE_LANGS_.length; i++) {
    if (DEEPL_WRITE_LANGS_[i].language.toLowerCase() === target.toLowerCase()) {
      supported = true;
      target = DEEPL_WRITE_LANGS_[i].language;
      break;
    }
  }
  if (!supported) {
    throw new Error(
      'DeepL Write nie wspiera języka „' +
        target +
        '” (brak PL). Wybierz np. en-US, de, fr…'
    );
  }

  var mode = writeOpts.mode === 'correct' ? 'correct' : 'rephrase';
  var path = mode === 'correct' ? '/v2/write/correct' : '/v2/write/rephrase';
  var payload = {
    text: [String(text)],
    target_lang: target,
  };
  if (mode === 'rephrase') {
    var style = String(writeOpts.writing_style || '').trim();
    var tone = String(writeOpts.tone || '').trim();
    if (style && tone) {
      tone = '';
    }
    if (style && style !== 'default') {
      payload.writing_style = style;
    }
    if (tone && tone !== 'default') {
      payload.tone = tone;
    }
  }

  var body = deeplFetch_(path, 'post', payload);
  var item =
    body && body.improvements && body.improvements[0] ? body.improvements[0] : null;
  if (!item || item.text === undefined) {
    throw new Error('DeepL Write nie zwrócił poprawionego tekstu.');
  }
  return {
    text: String(item.text),
    detected_source_language: String(item.detected_source_language || ''),
    target_language: String(item.target_language || target),
  };
}

/**
 * Natywna sugerowana zmiana Docs: delete + insert z writeMode=SUGGEST.
 * Wymaga scope documents + autoryzacji Docs API.
 */
function suggestReplaceSelectedText_(selected, newText) {
  var range = resolveSelectionDocsRange_(selected);
  var docId = DocumentApp.getActiveDocument().getId();
  var requests = [
    {
      deleteContentRange: {
        range: {
          startIndex: range.startIndex,
          endIndex: range.endIndex,
        },
      },
    },
    {
      insertText: {
        location: { index: range.startIndex },
        text: String(newText || ''),
      },
    },
  ];
  if (range.tabId) {
    requests[0].deleteContentRange.range.tabId = range.tabId;
    requests[1].insertText.location.tabId = range.tabId;
  }
  docsApiBatchUpdate_(docId, requests, { writeMode: 'SUGGEST' });
}

function docsApiBatchUpdate_(docId, requests, writeControl) {
  var url =
    'https://docs.googleapis.com/v1/documents/' +
    encodeURIComponent(docId) +
    ':batchUpdate';
  var payload = { requests: requests };
  if (writeControl) {
    payload.writeControl = writeControl;
  }
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    },
    payload: JSON.stringify(payload),
  });
  var code = response.getResponseCode();
  var text = response.getContentText() || '';
  var body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (ignore) {
    body = {};
  }
  if (code >= 400) {
    var msg =
      (body.error && body.error.message) ||
      text.slice(0, 400) ||
      'HTTP ' + code;
    if (code === 403 || /insufficient|scope|permission/i.test(msg)) {
      throw new Error(
        'Brak uprawnień Docs API do sugestii. W Apps Script: wdróż ponownie projekt ' +
          '(nowy scope documents), otwórz panel i zaakceptuj uprawnienia. Szczegóły: ' +
          msg
      );
    }
    throw new Error('Docs API batchUpdate błąd HTTP ' + code + ': ' + msg);
  }
  return body;
}

function docsApiGetDocument_(docId) {
  var url =
    'https://docs.googleapis.com/v1/documents/' +
    encodeURIComponent(docId) +
    '?suggestionsViewMode=SUGGESTIONS_INLINE';
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      Accept: 'application/json',
    },
  });
  var code = response.getResponseCode();
  var text = response.getContentText() || '';
  var body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (ignore) {
    body = {};
  }
  if (code >= 400) {
    var msg =
      (body.error && body.error.message) ||
      text.slice(0, 400) ||
      'HTTP ' + code;
    throw new Error('Docs API get błąd HTTP ' + code + ': ' + msg);
  }
  return body;
}

/**
 * Mapuje zaznaczenie DocumentApp → indeksy Docs API (start włącznie, end wyłącznie).
 */
function resolveSelectionDocsRange_(selected) {
  var needle = String(selected && selected.text || '');
  if (!needle) {
    throw new Error('Puste zaznaczenie — nie da się zbudować sugestii.');
  }
  var docId = DocumentApp.getActiveDocument().getId();
  var docJson = docsApiGetDocument_(docId);
  var segments = collectDocsTextSegments_(docJson);
  var haystack = '';
  var indexMap = []; // haystack offset → docs index
  for (var s = 0; s < segments.length; s++) {
    var seg = segments[s];
    for (var c = 0; c < seg.text.length; c++) {
      indexMap.push(seg.startIndex + c);
      haystack += seg.text.charAt(c);
    }
  }

  var matches = [];
  var from = 0;
  while (from <= haystack.length - needle.length) {
    var at = haystack.indexOf(needle, from);
    if (at < 0) {
      break;
    }
    matches.push(at);
    from = at + 1;
  }
  if (!matches.length) {
    // Fallback: DocumentApp replace — nie jako sugestia.
    throw new Error(
      'Nie udało się zmapować zaznaczenia na indeksy Docs API (tekst mógł się zmienić). ' +
        'Zaznacz ponownie krótszy, ciągły fragment w jednym akapicie.'
    );
  }
  if (matches.length > 1) {
    // Spróbuj zawęzić po kontekście pierwszego slice'a.
    var preferred = pickBestSelectionMatch_(matches, haystack, needle, selected);
    matches = [preferred];
  }
  var startOff = matches[0];
  var endOff = startOff + needle.length; // exclusive in haystack
  var startIndex = indexMap[startOff];
  var endIndex =
    endOff < indexMap.length
      ? indexMap[endOff]
      : indexMap[indexMap.length - 1] + 1;
  if (!(startIndex >= 1) || !(endIndex > startIndex)) {
    throw new Error('Niepoprawny zakres Docs API dla zaznaczenia.');
  }
  return {
    startIndex: startIndex,
    endIndex: endIndex,
    tabId: segments[0] && segments[0].tabId ? segments[0].tabId : '',
  };
}

function pickBestSelectionMatch_(matches, haystack, needle, selected) {
  var slices = (selected && selected.slices) || [];
  if (!slices.length) {
    return matches[0];
  }
  var elText = '';
  try {
    elText = slices[0].textElement.getText() || '';
  } catch (ignore) {}
  var localStart = slices[0].start || 0;
  var before = elText.substring(Math.max(0, localStart - 24), localStart);
  var afterEnd = localStart + needle.length;
  var after = elText.substring(afterEnd, Math.min(elText.length, afterEnd + 24));
  for (var i = 0; i < matches.length; i++) {
    var at = matches[i];
    var okBefore =
      !before ||
      haystack.substring(Math.max(0, at - before.length), at) === before;
    var okAfter =
      !after ||
      haystack.substring(at + needle.length, at + needle.length + after.length) ===
        after;
    if (okBefore && okAfter) {
      return at;
    }
  }
  return matches[0];
}

function collectDocsTextSegments_(docJson) {
  var segments = [];
  var body = docJson && docJson.body;
  if (body && body.content) {
    walkDocsStructuralElements_(body.content, segments, '');
  }
  // Dokumenty z kartami (tabs).
  var tabs = docJson && docJson.tabs;
  if (tabs && tabs.length) {
    for (var t = 0; t < tabs.length; t++) {
      var tab = tabs[t];
      var tabId = tab.tabId || (tab.documentTab && tab.documentTab.tabId) || '';
      var tabBody =
        tab.documentTab && tab.documentTab.body
          ? tab.documentTab.body
          : tab.body;
      if (tabBody && tabBody.content) {
        walkDocsStructuralElements_(tabBody.content, segments, tabId);
      }
    }
  }
  return segments;
}

function walkDocsStructuralElements_(elements, segments, tabId) {
  if (!elements || !elements.length) {
    return;
  }
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    if (el.paragraph && el.paragraph.elements) {
      walkDocsParagraphElements_(el.paragraph.elements, segments, tabId);
    }
    if (el.table && el.table.tableRows) {
      for (var r = 0; r < el.table.tableRows.length; r++) {
        var row = el.table.tableRows[r];
        var cells = row.tableCells || [];
        for (var c = 0; c < cells.length; c++) {
          walkDocsStructuralElements_(cells[c].content || [], segments, tabId);
        }
      }
    }
    if (el.tableOfContents && el.tableOfContents.content) {
      walkDocsStructuralElements_(el.tableOfContents.content, segments, tabId);
    }
  }
}

function walkDocsParagraphElements_(elements, segments, tabId) {
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    if (!el.textRun || el.textRun.content == null) {
      continue;
    }
    var content = String(el.textRun.content);
    // Docs API: każdy akapit kończy się \n — DocumentApp.getText() też je ma w elemencie.
    if (!content) {
      continue;
    }
    var startIndex = el.startIndex;
    if (startIndex === undefined || startIndex === null) {
      continue;
    }
    segments.push({
      text: content,
      startIndex: startIndex,
      tabId: tabId || '',
    });
  }
}

var DEEPL_SOURCE_FALLBACK_ = [
  { language: 'BG', name: 'Bulgarian' },
  { language: 'CS', name: 'Czech' },
  { language: 'DA', name: 'Danish' },
  { language: 'DE', name: 'German' },
  { language: 'EL', name: 'Greek' },
  { language: 'EN', name: 'English' },
  { language: 'ES', name: 'Spanish' },
  { language: 'ET', name: 'Estonian' },
  { language: 'FI', name: 'Finnish' },
  { language: 'FR', name: 'French' },
  { language: 'HU', name: 'Hungarian' },
  { language: 'ID', name: 'Indonesian' },
  { language: 'IT', name: 'Italian' },
  { language: 'JA', name: 'Japanese' },
  { language: 'KO', name: 'Korean' },
  { language: 'LT', name: 'Lithuanian' },
  { language: 'LV', name: 'Latvian' },
  { language: 'NB', name: 'Norwegian' },
  { language: 'NL', name: 'Dutch' },
  { language: 'PL', name: 'Polish' },
  { language: 'PT', name: 'Portuguese' },
  { language: 'RO', name: 'Romanian' },
  { language: 'RU', name: 'Russian' },
  { language: 'SK', name: 'Slovak' },
  { language: 'SL', name: 'Slovenian' },
  { language: 'SV', name: 'Swedish' },
  { language: 'TR', name: 'Turkish' },
  { language: 'UK', name: 'Ukrainian' },
  { language: 'ZH', name: 'Chinese' },
];

var DEEPL_TARGET_FALLBACK_ = [
  { language: 'BG', name: 'Bulgarian' },
  { language: 'CS', name: 'Czech' },
  { language: 'DA', name: 'Danish' },
  { language: 'DE', name: 'German' },
  { language: 'EL', name: 'Greek' },
  { language: 'EN-GB', name: 'English (British)' },
  { language: 'EN-US', name: 'English (American)' },
  { language: 'ES', name: 'Spanish' },
  { language: 'ET', name: 'Estonian' },
  { language: 'FI', name: 'Finnish' },
  { language: 'FR', name: 'French' },
  { language: 'HU', name: 'Hungarian' },
  { language: 'ID', name: 'Indonesian' },
  { language: 'IT', name: 'Italian' },
  { language: 'JA', name: 'Japanese' },
  { language: 'KO', name: 'Korean' },
  { language: 'LT', name: 'Lithuanian' },
  { language: 'LV', name: 'Latvian' },
  { language: 'NB', name: 'Norwegian' },
  { language: 'NL', name: 'Dutch' },
  { language: 'PL', name: 'Polish' },
  { language: 'PT-BR', name: 'Portuguese (Brazilian)' },
  { language: 'PT-PT', name: 'Portuguese (European)' },
  { language: 'RO', name: 'Romanian' },
  { language: 'RU', name: 'Russian' },
  { language: 'SK', name: 'Slovak' },
  { language: 'SL', name: 'Slovenian' },
  { language: 'SV', name: 'Swedish' },
  { language: 'TR', name: 'Turkish' },
  { language: 'UK', name: 'Ukrainian' },
  { language: 'ZH', name: 'Chinese (simplified)' },
];

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
  const headers = { Accept: 'application/json' };
  const apiKey = getZotero20ApiKey();
  if (!apiKey) {
    throw new Error(
      'Brak klucza API serwera — otwórz zakładkę Ustawienia w panelu i wklej klucz Zotero20.'
    );
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
    var friendly = humanizeHttpError_(code, text);
    if (friendly) {
      detail = friendly;
    } else if (detail) {
      detail = stripHtmlNoise_(String(detail)).substring(0, 400);
    }
    var message = detail || ('HTTP ' + code);
    if (getDebugMode()) {
      message +=
        '\n[debug] HTTP ' +
        code +
        '\n' +
        stripHtmlNoise_(String(text)).substring(0, 400);
    }
    throw new Error(message);
  }
  return body;
}

/**
 * Cloudflare / HTML zamiast JSON API — krótki komunikat zamiast surowej strony błędu.
 * Typowe: 520 „origin web server returned an invalid or incomplete response”.
 */
function humanizeHttpError_(code, text) {
  var raw = String(text || '');
  var lower = raw.toLowerCase();
  var isHtml = raw.indexOf('<!DOCTYPE') >= 0 || raw.indexOf('<html') >= 0 || raw.indexOf('<HTML') >= 0;
  var looksCloudflare =
    lower.indexOf('cloudflare') >= 0 ||
    lower.indexOf('cf-error') >= 0 ||
    lower.indexOf('origin web server returned') >= 0 ||
    lower.indexOf('error code 52') >= 0 ||
    lower.indexOf('attention required') >= 0;
  if (looksCloudflare || (isHtml && code >= 500) || code === 520 || code === 521 || code === 522 || code === 524) {
    return (
      'Proxy (Cloudflare) HTTP ' +
      code +
      ' — origin nie zwrócił pełnej odpowiedzi (timeout/reset). ' +
      'Odśwież panel. Gemini z kluczem w Ustawieniach idzie bezpośrednio do Google, nie przez VPS.'
    );
  }
  if (isHtml) {
    var stripped = stripHtmlNoise_(raw);
    return stripped
      ? 'HTTP ' + code + ': ' + stripped.substring(0, 280)
      : 'HTTP ' + code + ' (odpowiedź HTML zamiast JSON API).';
  }
  return '';
}

function stripHtmlNoise_(text) {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
