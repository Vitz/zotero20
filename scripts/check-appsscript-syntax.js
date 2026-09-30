#!/usr/bin/env node
/**
 * Sprawdza składnię Code.gs i skryptu z Sidebar.html oraz zgodność numerów wersji.
 * Apps Script nie ma lintera w CI, a błąd składni objawia się dopiero w Docs.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sidebarDir = path.join(__dirname, '..', 'google-docs', 'sidebar');
const codePath = path.join(sidebarDir, 'Code.gs');
const htmlPath = path.join(sidebarDir, 'Sidebar.html');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function checkSyntax(label, source) {
  try {
    new vm.Script(source, { filename: label });
    console.log(`OK: ${label} — składnia poprawna`);
    return true;
  } catch (error) {
    fail(`${label} — ${error.message}`);
    return false;
  }
}

const codeSource = fs.readFileSync(codePath, 'utf8');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');

checkSyntax('Code.gs', codeSource);

const scriptMatch = htmlSource.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  fail('Sidebar.html — nie znaleziono bloku <script>');
} else {
  checkSyntax('Sidebar.html <script>', scriptMatch[1]);
}

const addonVersion = (codeSource.match(/ADDON_VERSION\s*=\s*'([^']+)'/) || [])[1];
const sidebarVersion = (htmlSource.match(/SIDEBAR_VERSION\s*=\s*'([^']+)'/) || [])[1];

if (!addonVersion) {
  fail('Code.gs — brak stałej ADDON_VERSION');
} else if (!sidebarVersion) {
  fail('Sidebar.html — brak stałej SIDEBAR_VERSION');
} else if (addonVersion !== sidebarVersion) {
  fail(`Niezgodne wersje: Code.gs=${addonVersion}, Sidebar.html=${sidebarVersion}`);
} else {
  console.log(`OK: wersje zgodne (${addonVersion})`);
}

// Każda funkcja wołana przez google.script.run musi istnieć w Code.gs.
const declared = new Set(
  [...codeSource.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)].map((match) => match[1])
);
const chainHelpers = new Set(['withSuccessHandler', 'withFailureHandler', 'withUserObject']);
// Wywołania przez zmienną (runner[nazwa](…)) — nie da się ich wykryć skanowaniem łańcucha.
const dynamicCalls = ['insertBibliography', 'refreshBibliography'];

function collectServerCalls(source) {
  const names = new Set();
  const marker = 'google.script.run';
  let cursor = source.indexOf(marker);

  while (cursor !== -1) {
    let i = cursor + marker.length;
    let parens = 0;
    let braces = 0;

    while (i < source.length) {
      const char = source[i];
      if (char === '(') parens += 1;
      else if (char === ')') parens -= 1;
      else if (char === '{') braces += 1;
      else if (char === '}') braces -= 1;
      else if (char === ';' && parens === 0 && braces === 0) break;
      else if (char === '.' && parens === 0 && braces === 0) {
        const call = /^\.\s*([A-Za-z0-9_]+)\s*\(/.exec(source.slice(i));
        if (call && !chainHelpers.has(call[1])) {
          names.add(call[1]);
        }
      }
      i += 1;
    }

    cursor = source.indexOf(marker, i);
  }

  return names;
}

const called = collectServerCalls(htmlSource);
dynamicCalls.forEach((name) => called.add(name));

const missing = [...called].filter((name) => !declared.has(name));
if (missing.length) {
  fail(`Sidebar.html woła nieistniejące funkcje Code.gs: ${missing.join(', ')}`);
} else {
  console.log(`OK: ${called.size} wywołań google.script.run ma odpowiednik w Code.gs`);
}
