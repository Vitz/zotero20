#!/bin/sh
set -e

mkdir -p /app/data

if [ ! -f /app/config/studies.yaml ]; then
  if [ -f /app/config/studies.yaml.example ]; then
    cp /app/config/studies.yaml.example /app/config/studies.yaml
    echo "Skopiowano studies.yaml.example → studies.yaml"
  fi
fi

if [ "$1" = "gunicorn" ]; then
  shift
  exec gunicorn zotero20.wsgi:application \
    --bind "0.0.0.0:8000" \
    --workers "${GUNICORN_WORKERS:-1}" \
    --timeout "${GUNICORN_TIMEOUT:-120}"
fi

exec "$@"
