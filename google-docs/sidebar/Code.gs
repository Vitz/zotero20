/**
 * Zotero20 — panel importu ORCID/DOI (jeden host + klucz API)
 * Base: https://zotero.keyweb.pl
 */

const API_BASE = 'https://zotero.keyweb.pl/api/v1';
const PROP_DEFAULT_COLLECTION_KEY = 'ZOTERO20_DEFAULT_COLLECTION_KEY';
const PROP_DEFAULT_COLLECTION_NAME = 'ZOTERO20_DEFAULT_COLLECTION_NAME';
const PROP_BIBLIOGRAPHY_STYLE = 'ZOTERO20_BIBLIOGRAPHY_STYLE';
const NAMED_RANGE_BIBLIOGRAPHY = 'ZOTERO20_BIBLIOGRAPHY';
const NAMED_RANGE_CITE_PREFIX = 'ZOTERO20_CITE_';
const PROP_CITATION_RANGES = 'ZOTERO20_CITATION_RANGES';
const BIBLIOGRAPHY_HEADING = 'Bibliografia';

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
      citationText = getItemCitationText(itemKey);
    } catch (e) {
      citationText = '';
    }
  }
  if (citationText && !result.duplicate) {
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

function getBibliographyStyle() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty(PROP_BIBLIOGRAPHY_STYLE) || 'apa';
}

function saveBibliographyStyle(styleId) {
  styleId = String(styleId || '').trim();
  if (!styleId) {
    throw new Error('Wybierz styl bibliografii.');
  }
  PropertiesService.getScriptProperties().setProperty(PROP_BIBLIOGRAPHY_STYLE, styleId);
  return getBibliographyStyle();
}

function refreshInTextCitations() {
  return refreshInTextCitations_();
}

function refreshInTextCitations_() {
  var style = getBibliographyStyle();
  var doc = DocumentApp.getActiveDocument();
  var entries = loadCitationRanges_();
  if (!entries.length) {
    return {
      updated: 0,
      skipped: 0,
      errors: [],
      style: style,
      message: 'Brak śledzonych cytowań w dokumencie (wstaw przez [*] z panelu).',
    };
  }

  var updated = 0;
  var skipped = 0;
  var errors = [];
  var stillValid = [];

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var named = doc.getNamedRanges(entry.name);
    if (!named || !named.length) {
      skipped++;
      continue;
    }

    try {
      var newText = getItemCitationText(entry.item_key, style);
      if (updateCitationNamedRange_(named[0], entry.name, newText)) {
        updated++;
        stillValid.push(entry);
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push(entry.item_key + ': ' + (e.message || String(e)));
      stillValid.push(entry);
    }
  }

  saveCitationRanges_(stillValid);

  return {
    updated: updated,
    skipped: skipped,
    errors: errors,
    style: style,
  };
}

function insertBibliography() {
  return upsertBibliography_(false);
}

function refreshBibliography() {
  return upsertBibliography_(true);
}

function upsertBibliography_(isRefresh) {
  var collection = getDefaultCollection();
  if (!collection.key) {
    throw new Error('Ustaw domyślną kolekcję w zakładce Ustawienia.');
  }
  var style = getBibliographyStyle();
  var data = apiPost('/bibliography', {
    collection_key: collection.key,
    style: style,
  });
  var entries = (data.entries || [])
    .map(function (e) { return String(e).trim(); })
    .filter(function (e) { return e; });
  if (!entries.length) {
    var hint = (data.item_count || 0) > 0
      ? 'Zotero zwróciło pustą bibliografię mimo pozycji w kolekcji — spróbuj inny styl lub odśwież po chwili.'
      : 'Kolekcja jest pusta — brak pozycji do bibliografii.';
    throw new Error(hint);
  }
  var result = writeBibliographyToDocument_(entries, data.style_label || style, isRefresh);
  result.collection_key = collection.key;
  result.collection_name = collection.name;
  result.style = data.style || style;
  result.style_label = data.style_label || style;
  result.item_count = data.item_count || entries.length;
  return result;
}

/**
 * Wstawia lub odświeża sekcję bibliografii na końcu dokumentu.
 * Zakres oznaczony NamedRange ZOTERO20_BIBLIOGRAPHY (nagłówek + wpisy).
 */
function writeBibliographyToDocument_(entries, styleLabel, isRefresh) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var hadExisting = removeBibliographySection_(doc, body);

  if (isRefresh && !hadExisting) {
    throw new Error('Brak bibliografii w dokumencie — użyj „Wstaw literaturę”.');
  }

  body.appendParagraph(BIBLIOGRAPHY_HEADING).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  var startIdx = body.getNumChildren() - 1;

  for (var i = 0; i < entries.length; i++) {
    body.appendParagraph(String(entries[i]));
  }

  var rangeBuilder = doc.newRange();
  for (var j = startIdx; j < body.getNumChildren(); j++) {
    var child = body.getChild(j);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) {
      continue;
    }
    var paragraph = child.asParagraph();
    if (!paragraph.getText()) {
      continue;
    }
    // NamedRange: Paragraph bez offsetów (offsety tylko dla Text).
    rangeBuilder.addElement(paragraph);
  }

  doc.addNamedRange(NAMED_RANGE_BIBLIOGRAPHY, rangeBuilder.build());

  return {
    inserted: !hadExisting,
    refreshed: hadExisting,
    item_count: entries.length,
    style_label: styleLabel,
  };
}

function removeBibliographySection_(doc, body) {
  var named = doc.getNamedRanges(NAMED_RANGE_BIBLIOGRAPHY);
  if (!named || !named.length) {
    return false;
  }

  var range = named[0].getRange();
  var elements = range.getRangeElements();
  var seen = {};
  for (var i = 0; i < elements.length; i++) {
    var element = elements[i].getElement();
    if (!element || !element.getParent) {
      continue;
    }
    var parent = element.getParent();
    if (parent && parent.getType && parent.getType() === DocumentApp.ElementType.BODY) {
      var idx = parent.getChildIndex(element);
      if (idx >= 0) {
        seen[idx] = element;
      }
    }
  }

  named[0].remove();

  var indices = Object.keys(seen).map(function (k) { return parseInt(k, 10); });
  indices.sort(function (a, b) { return b - a; });
  for (var j = 0; j < indices.length; j++) {
    body.getChild(indices[j]).removeFromParent();
  }

  return indices.length > 0;
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

function pasteCitationForItem(itemKey, identifiers) {
  var key = String(itemKey || '').trim();
  if (!key) {
    throw new Error('Brak klucza pozycji — zaimportuj DOI ponownie lub wybierz pozycję z listy.');
  }
  var citationText = '';
  try {
    citationText = getItemCitationText(key);
  } catch (e) {
    throw new Error('Nie udało się pobrać cytowania: ' + (e.message || String(e)));
  }
  if (!citationText) {
    throw new Error('Brak tekstu cytowania dla pozycji ' + key + '.');
  }
  replacePlaceholderInDocument_(citationText, identifiers || {}, key);
  return { replaced: true, citation_text: citationText, item_key: key, tracked: true };
}

/** Widoczny komunikat w dokumencie (modal) — wywoływany z sidebara po wklejeniu. */
function showPasteAlert(message, isError) {
  var title = isError ? 'Zotero20 — błąd' : 'Zotero20';
  DocumentApp.getUi().alert(title, String(message || ''), DocumentApp.getUi().ButtonSet.OK);
}

/**
 * Zamienia pierwszy placeholder w dokumencie na podany tekst.
 * Gdy podano itemKey, cytowanie jest śledzone (NamedRange) do odświeżania stylu.
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
        registerTrackedCitation_(result.textElement, result.start, result.end, itemKey);
      }
      return { pattern: patterns[i], text: text, item_key: itemKey || '' };
    }
  }

  throw new Error(
    'Brak [*] — wpisz placeholder w dokumencie (np. [*] lub [DOI]) i spróbuj ponownie.'
  );
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

function registerTrackedCitation_(textElement, start, end, itemKey) {
  var doc = DocumentApp.getActiveDocument();
  var rangeName = allocateCitationRangeName_(doc, itemKey);
  var rangeBuilder = doc.newRange();
  rangeBuilder.addElement(textElement, start, end);
  doc.addNamedRange(rangeName, rangeBuilder.build());
  rememberCitationRange_(rangeName, itemKey);
}

function allocateCitationRangeName_(doc, itemKey) {
  var base = NAMED_RANGE_CITE_PREFIX + String(itemKey).trim();
  if (!doc.getNamedRanges(base).length) {
    return base;
  }
  var n = 2;
  while (doc.getNamedRanges(base + '_' + n).length) {
    n++;
  }
  return base + '_' + n;
}

function rememberCitationRange_(rangeName, itemKey) {
  var entries = loadCitationRanges_();
  var filtered = entries.filter(function (e) { return e.name !== rangeName; });
  filtered.push({
    name: rangeName,
    item_key: String(itemKey || '').trim(),
    at: new Date().toISOString(),
  });
  saveCitationRanges_(filtered);
}

function loadCitationRanges_() {
  var raw = PropertiesService.getDocumentProperties().getProperty(PROP_CITATION_RANGES) || '[]';
  try {
    var entries = JSON.parse(raw);
    return Array.isArray(entries) ? entries : [];
  } catch (e) {
    return [];
  }
}

function saveCitationRanges_(entries) {
  PropertiesService.getDocumentProperties().setProperty(
    PROP_CITATION_RANGES,
    JSON.stringify(entries || [])
  );
}

function updateCitationNamedRange_(namedRange, rangeName, newText) {
  var range = namedRange.getRange();
  var elements = range.getRangeElements();
  if (!elements.length) {
    return false;
  }

  var doc = DocumentApp.getActiveDocument();
  var textElement = elements[0].getElement().asText();
  var start = elements[0].getStartOffset();
  var end = elements[elements.length - 1].getEndOffsetInclusive();

  textElement.deleteText(start, end);
  textElement.insertText(start, newText);

  namedRange.remove();

  var rangeBuilder = doc.newRange();
  var newEnd = start + newText.length - 1;
  rangeBuilder.addElement(textElement, start, newEnd);
  doc.addNamedRange(rangeName, rangeBuilder.build());

  return true;
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
  const response = UrlFetchApp.fetch(API_BASE + path, {
    method: 'get',
    muteHttpExceptions: true,
    headers: apiHeaders_(),
  });
  return parseResponse_(response);
}

function apiPost(path, payload) {
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
    throw new Error(body.error || body.raw || ('HTTP ' + code));
  }
  return body;
}
