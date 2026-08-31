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
