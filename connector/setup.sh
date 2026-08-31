#!/usr/bin/env bash
# Klonuje zotero-connectors i przygotowuje katalog do npm run build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM="${ROOT}/upstream"
BRANCH="${ZOTERO_CONNECTORS_BRANCH:-master}"

if [ ! -d "${UPSTREAM}/.git" ]; then
  echo "Cloning zotero-connectors..."
  git clone --depth 1 --branch "${BRANCH}" \
    https://github.com/zotero/zotero-connectors.git "${UPSTREAM}"
fi

echo "Applying zotero20 customizations..."

HTTP_JS="${UPSTREAM}/src/common/http.js"
if [ -f "${HTTP_JS}" ]; then
  if ! grep -q "zotero20-api-key" "${HTTP_JS}"; then
    cat >> "${HTTP_JS}" <<'PATCH'

// zotero20-api-key: Django gateway auth (X-API-Key)
(function () {
  const _fetch = Zotero.HTTP.request;
  Zotero.HTTP.request = async function (method, url, options = {}) {
    options.headers = options.headers || {};
    const apiKey = await Zotero.Prefs.getAsync('zotero20.apiKey', true);
    if (apiKey) options.headers['X-API-Key'] = apiKey;
    return _fetch.call(this, method, url, options);
  };
})();
PATCH
    echo "Patched ${HTTP_JS} (X-API-Key)"
  fi
else
  echo "WARN: ${HTTP_JS} not found — upstream layout may have changed."
fi

MANIFEST="${UPSTREAM}/src/browserSpecific/chrome/manifest.json"
if [ -f "${MANIFEST}" ]; then
  sed -i.bak 's/"name": "Zotero Connector"/"name": "Zotero20 Connector"/' "${MANIFEST}" || true
fi

echo "Done. Run: cd ${UPSTREAM} && npm install && npm run build"
echo "W Options wtyczki ustaw:"
echo "  connector.url = https://zotero.keyweb.pl"
echo "  zotero20.apiKey = <ZOTERO20_API_KEY z .env>"
