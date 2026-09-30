#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspace"
cd "$ROOT"

fix_crlf() {
  for f in setup.sh upstream/build.sh; do
    [ -f "$f" ] && sed -i 's/\r$//' "$f" || true
  done
}
fix_crlf

echo "==> Zotero20 Connector — setup (clone, submodules, patches)"
bash ./setup.sh

echo "==> npm install"
cd upstream
fix_crlf
npm install

echo "==> build.sh"
bash ./build.sh

test -f build/manifestv3/manifest.json
test -f build/firefox/manifest.json

bash "${ROOT}/package-firefox-xpi.sh"

echo ""
echo "OK — Chrome (Load unpacked):"
echo "  ${ROOT}/upstream/build/manifestv3"
echo ""
echo "OK — Firefox (about:debugging → Załaduj tymczasowy dodatek):"
echo "  ${ROOT}/upstream/build/firefox"
echo "  lub XPI: ${ROOT}/upstream/build/zotero20-connector-firefox.xpi"
