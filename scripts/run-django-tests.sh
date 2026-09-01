#!/usr/bin/env bash
# Uruchamia testy Django (pytest) z mockami Zotero — bez pełnego kontenera Zotero.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DJANGO_DIR="${ROOT}/server/django"

cd "${DJANGO_DIR}"

export DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-test-secret-key}"
export DJANGO_DEBUG="${DJANGO_DEBUG:-true}"
export ZOTERO20_API_KEY="${ZOTERO20_API_KEY:-test-api-key}"
export ZOTERO_URL="${ZOTERO_URL:-http://127.0.0.1:23119}"
export ZOTERO_WEB_API_KEY=""

python -m pip install -q -r requirements.txt -r requirements-dev.txt

echo "== pytest (unit + API z mockami Zotero) =="
python -m pytest "$@" -v --tb=short
