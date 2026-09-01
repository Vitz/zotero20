#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/bin:/usr/local/bin:$PATH"
ROOT="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM="$ROOT/upstream"

# Ensure Node 20+ in WSL (Windows npm install alone is not enough for build.sh)
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  export NVM_DIR="$HOME/.nvm"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    echo "Instaluję nvm + Node 20 (jednorazowo)..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
fi

cd "$UPSTREAM"
if [[ ! -d node_modules ]]; then
  npm install
fi

sed -i 's/\r$//' build.sh 2>/dev/null || true
./build.sh
test -f build/manifestv3/manifest.json
test -f build/firefox/manifest.json
bash "$ROOT/package-firefox-xpi.sh"
echo ""
echo "Chrome (Load unpacked):"
echo "  $UPSTREAM/build/manifestv3"
echo ""
echo "Firefox (about:debugging):"
echo "  $UPSTREAM/build/firefox"
echo "  XPI: $UPSTREAM/build/zotero20-connector-firefox.xpi"
