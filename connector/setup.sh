#!/usr/bin/env bash
# Klonuje zotero-connectors, inicjalizuje submoduły i nakłada patche Zotero20.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM="${ROOT}/upstream"
PATCHES="${ROOT}/patches"
CONFIG="${ROOT}/config.json"
BRANCH="${ZOTERO_CONNECTORS_BRANCH:-master}"

CONNECTOR_URL="https://zotero.keyweb.pl/"
EXTENSION_NAME="Zotero20 Connector"

if [ -f "${CONFIG}" ]; then
  _read_config() {
    local py="$1"
    local url name
    url="$("$py" -c "import json; c=json.load(open('${CONFIG}')); print(c.get('connectorUrl','https://zotero.keyweb.pl').rstrip('/')+'/')" 2>/dev/null)" || return 1
    name="$("$py" -c "import json; print(json.load(open('${CONFIG}')).get('extensionName','Zotero20 Connector'))" 2>/dev/null)" || return 1
    [ -n "$url" ] && [ -n "$name" ] || return 1
    CONNECTOR_URL="$url"
    EXTENSION_NAME="$name"
  }
  if command -v python >/dev/null 2>&1 && python -c "import json" >/dev/null 2>&1 && _read_config python; then
    :
  elif command -v python3 >/dev/null 2>&1 && python3 -c "import json" >/dev/null 2>&1 && _read_config python3; then
    :
  else
    echo "WARN: python not available — using default connector URL from patches"
  fi
fi

apply_patch() {
  local patch="$1"
  local path="${PATCHES}/${patch}"
  if [ ! -f "$path" ]; then
    echo "WARN: missing patch ${patch}"
    return 0
  fi
  if git -C "${UPSTREAM}" apply --check "$path" >/dev/null 2>&1; then
    git -C "${UPSTREAM}" apply "$path"
    echo "  Applied ${patch}"
  else
    echo "  Skipped ${patch} (already applied or upstream changed)"
  fi
}

if [ ! -d "${UPSTREAM}/.git" ]; then
  echo "Cloning zotero-connectors (branch ${BRANCH})..."
  git clone --depth 1 --branch "${BRANCH}" \
    https://github.com/zotero/zotero-connectors.git "${UPSTREAM}"
fi

echo "Initializing submodules..."
git -C "${UPSTREAM}" submodule update --init --depth 1 \
  src/zotero-google-docs-integration \
  src/translate \
  src/utilities \
  src/zotero

echo "Applying Zotero20 patches..."
apply_patch "001-remote-url-default.patch"
apply_patch "002-api-key-header.patch"
apply_patch "003-sidebar-postmessage.patch"

ZOTERO_JS="${UPSTREAM}/src/common/zotero.js"
if [ -f "${ZOTERO_JS}" ] && [ -n "${CONNECTOR_URL}" ]; then
  perl -pi -e "s|'connector.url': 'https?://[^']+'|'connector.url': '${CONNECTOR_URL}'|" "${ZOTERO_JS}"
fi

for manifest in \
  "${UPSTREAM}/src/browserExt/manifest.json" \
  "${UPSTREAM}/src/browserExt/manifest-v3.json"; do
  if [ -f "${manifest}" ]; then
    perl -pi -e 's/"name": "Zotero Connector"/"name": "'"${EXTENSION_NAME}"'"/' "${manifest}" || true
    perl -pi -e 's/"name": "Zotero20 Connector"/"name": "'"${EXTENSION_NAME}"'"/' "${manifest}" || true
  fi
done

echo ""
echo "Done. Build:"
echo "  cd ${UPSTREAM} && npm install && ./build.sh"
echo ""
echo "Chrome (MV3): Load unpacked → ${UPSTREAM}/build/manifestv3"
echo ""
echo "W Config Editor wtyczki ustaw:"
echo "  connector.url = ${CONNECTOR_URL}"
echo "  zotero20.apiKey = <ZOTERO20_API_KEY z server/.env>"
