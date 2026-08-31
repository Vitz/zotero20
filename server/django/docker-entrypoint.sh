#!/bin/sh
set -e

mkdir -p /app/data

if [ ! -f /app/config/studies.yaml ]; then
  if [ -f /app/config/studies.yaml.example ]; then
    cp /app/config/studies.yaml.example /app/config/studies.yaml
    echo "Skopiowano studies.yaml.example → studies.yaml"
  fi
fi

exec "$@"
