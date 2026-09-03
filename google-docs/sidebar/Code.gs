/**
 * Zotero20 — panel importu ORCID/DOI (jeden host + klucz API)
 * Base: https://zotero.keyweb.pl
 */

const API_BASE = 'https://zotero.keyweb.pl/api/v1';
// Podbij przy każdej zmianie Code.gs — sidebar porównuje wersje i ostrzega przy niezgodności.
const ADDON_VERSION = '2.0.2';
const PROP_DEFAULT_COLLECTION_KEY = 'ZOTERO20_DEFAULT_COLLECTION_KEY';
const PROP_DEFAULT_COLLECTION_NAME = 'ZOTERO20_DEFAULT_COLLECTION_NAME';
const PROP_BIBLIOGRAPHY_STYLE = 'ZOTERO20_BIBLIOGRAPHY_STYLE';
const PROP_BIBLIOGRAPHY_CITED_ONLY = 'ZOTERO20_BIBLIOGRAPHY_CITED_ONLY';
const PROP_CITATION_INSERT_MODE = 'ZOTERO20_CITATION_INSERT_MODE';
const PROP_DEBUG = 'ZOTERO20_DEBUG';
const NAMED_RANGE_BIBLIOGRAPHY = 'ZOTERO20_BIBLIOGRAPHY';
const BIBLIOGRAPHY_HEADING = 'Bibliografia';

/**
 * Kotwica cytowania = ukryty link na tekście cytowania.
 * W przeciwieństwie do NamedRange link przeżywa kopiuj/wklej, cofnięcie zmian,
 * zamknięcie dokumentu i zrobienie kopii pliku — to najbliższy odpowiednik
 * pól Zotero, jaki daje Apps Script.
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

function getStudies() {
  return apiGet('/studies');
}

function getDefaultCollection() {
  const props = PropertiesService.getScriptProperties();
  return {
    key: props.getProperty(PROP_DEFAULT_COLLECTION_KEY) || '',
    name: props.getProperty(PROP_DEFAULT_COLLECTION_NAME) || '',
  };
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
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_DEFAULT_COLLECTION_KEY, key);
  props.setProperty(PROP_DEFAULT_COLLECTION_NAME, name || key);
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

function getCollectionItems(collectionKey, limit) {
  var key = String(collectionKey || '').trim();
  if (!key) {
    throw new Error('Brak klucza kolekcji.');
  }
  var lim = limit || 20;
  return apiGet('/collection-items?collection_key=' + encodeURIComponent(key) + '&limit=' + lim);
}

function getBibliographyStyles() {
  return apiGet('/styles');
}

function getAddonVersion() {
  return ADDON_VERSION;
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
  var updated = rewriteCitationRuns_(citations, data.citation_by_key);

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
    throw new Error('Tryb „cała kolekcja” wymaga domyślnej kolekcji — ustaw ją w zakładce Ustawienia.');
  }

  var data = apiPost('/bibliography', { style: style, collection_key: collection.key });
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
  var data = apiPost('/citations', { style: style, item_keys: keys });
  var byKey = {};
  var list = data.citations || [];
  for (var i = 0; i < list.length; i++) {
    var text = String(list[i].citation_text || '').trim();
    var key = normalizeItemKey_(list[i].item_key);
    if (key && text) {
      byKey[key] = text;
    }
  }
  return {
    citation_by_key: byKey,
    entries: normalizeEntries_(data.entries),
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

  attachBibliographyNamedRange_(doc, body, startIdx, entries.length);

  return {
    inserted: true,
    refreshed: false,
    item_count: entries.length,
    style_label: styleLabel,
  };
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
  if (style) {
    path += '?style=' + encodeURIComponent(style);
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

  var citedKeys = uniqueItemKeys_(getTrackedCitations_());
  if (citedKeys.indexOf(key) >= 0) {
    throw new Error(
      'Ta pozycja jest już cytowana w dokumencie (klucz ' + key + '). ' +
      'Usuń istniejące cytowanie, jeśli chcesz wstawić je ponownie.'
    );
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
  var placement =
    mode === 'placeholder'
      ? replacePlaceholderInDocument_(citationText, identifiers || {}, key)
      : insertCitationAtCursor_(citationText, key);

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
function replacePlaceholderInDocument_(text, identifiers, itemKey) {
  identifiers = identifiers || {};
  var body = DocumentApp.getActiveDocument().getBody();
  var patterns = buildPlaceholderPatterns_(identifiers);

  for (var i = 0; i < patterns.length; i++) {
    var result = replaceFirstLiteral_(body, patterns[i], text);
    if (result) {
      if (itemKey) {
        applyCitationLink_(result.textElement, result.start, result.end, itemKey, newCitationId_());
      }
      return { mode: 'placeholder', pattern: patterns[i], text: text, item_key: itemKey || '' };
    }
  }

  throw new Error(
    'Brak [*] — wpisz placeholder w dokumencie (np. [*] lub [DOI]) i spróbuj ponownie, ' +
    'albo przełącz wstawianie na „w miejscu kursora”.'
  );
}

/** Wstawia cytowanie tam, gdzie stoi kursor w dokumencie. */
function insertCitationAtCursor_(text, itemKey) {
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
  applyCitationLink_(textElement, offset, offset + text.length - 1, itemKey, newCitationId_());
  return { mode: 'cursor', text: text, item_key: itemKey };
}

function newCitationId_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function buildCitationUrl_(itemKey, citationId) {
  return (
    CITE_LINK_BASE +
    encodeURIComponent(normalizeItemKey_(itemKey)) +
    '?c=' +
    encodeURIComponent(citationId || newCitationId_())
  );
}

function normalizeItemKey_(itemKey) {
  return String(itemKey || '').trim().toUpperCase();
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
  return { itemKey: itemKey, citationId: citationId };
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
function applyCitationLink_(textElement, start, end, itemKey, citationId) {
  if (end < start) {
    return;
  }
  textElement.setLinkUrl(start, end, buildCitationUrl_(itemKey, citationId));
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
 * Podmienia tekst cytowań na nowy. Idzie od końca dokumentu, bo każda zmiana
 * długości tekstu przesuwa offsety kolejnych cytowań w tym samym akapicie.
 */
function rewriteCitationRuns_(runs, citationByKey) {
  var updated = 0;
  var unchanged = 0;
  var skipped = 0;
  var normalizedMap = {};
  Object.keys(citationByKey || {}).forEach(function (k) {
    normalizedMap[normalizeItemKey_(k)] = citationByKey[k];
  });

  for (var i = runs.length - 1; i >= 0; i--) {
    var run = runs[i];
    var itemKey = normalizeItemKey_(run.item_key);
    var newText = normalizedMap[itemKey];
    if (!newText) {
      skipped++;
      continue;
    }

    var currentText = citationRunText_(run.textElement, run.start, run.end);
    if (currentText === newText) {
      unchanged++;
      continue;
    }

    run.textElement.deleteText(run.start, run.end);
    run.textElement.insertText(run.start, newText);
    run.end = run.start + newText.length - 1;
    applyCitationLink_(run.textElement, run.start, run.end, itemKey, run.citation_id);
    updated++;
  }

  return { updated: updated, unchanged: unchanged, skipped: skipped };
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
  var type = identifiers.type || '';
  var value = String(identifiers.value || '').trim();

  if (type === 'doi' && value) {
    patterns.push('[doi]', '[' + value + ']', '[doi:' + value + ']');
    var bare = value.replace(/^doi:/i, '');
    if (bare !== value) {
      patterns.push('[' + bare + ']');
    }
  } else if (type === 'orcid' && value) {
    patterns.push('[orcid]', '[' + value + ']');
  } else if (type === 'pmid' && value) {
    patterns.push('[pmid]', '[' + value + ']');
  } else if (value) {
    patterns.push('[' + value + ']');
  }

  if (identifiers.extra && identifiers.extra.length) {
    for (var j = 0; j < identifiers.extra.length; j++) {
      var extra = String(identifiers.extra[j] || '').trim();
      if (extra) {
        patterns.push('[' + extra + ']');
      }
    }
  }

  var seen = {};
  return patterns.filter(function (p) {
    if (seen[p]) return false;
    seen[p] = true;
    return true;
  });
}

function buildIdentifiers_(type, value) {
  return { type: type, value: String(value || '').trim() };
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
