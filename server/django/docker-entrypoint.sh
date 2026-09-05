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
  python manage.py collectstatic --noinput
  # gthread: 1 worker + N wątków — /health nie czeka za sync Gemini (CF Free ~100s).
  # Mikrus ~1.2GB: nie podnoś WORKERS bez pomiaru RAM; THREADS=2 jest tanie.
  exec gunicorn zotero20.wsgi:application \
    --bind "0.0.0.0:8000" \
    --worker-class gthread \
    --workers "${GUNICORN_WORKERS:-1}" \
    --threads "${GUNICORN_THREADS:-2}" \
    --timeout "${GUNICORN_TIMEOUT:-180}"
fi

exec "$@"
