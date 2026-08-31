/**
 * Zotero20 — panel importu ORCID/DOI (jeden host + klucz API)
 * Base: https://zotero.keyweb.pl
 */

const API_BASE = 'https://zotero.keyweb.pl/api/v1';

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

function getStudies() {
  return apiGet('/studies');
}

function importDoi(doi, study) {
  return apiPost('/import/doi', { doi: doi, study: study });
}

function importOrcid(orcid, study, limit) {
  return apiPost('/import/orcid', {
    orcid: orcid,
    study: study,
    limit: limit || 50,
  });
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
