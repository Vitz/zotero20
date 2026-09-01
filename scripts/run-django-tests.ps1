# Uruchamia testy Django (pytest) z mockami Zotero — bez pełnego kontenera Zotero.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$DjangoDir = Join-Path $Root "server\django"

Set-Location $DjangoDir

if (-not $env:DJANGO_SECRET_KEY) { $env:DJANGO_SECRET_KEY = "test-secret-key" }
if (-not $env:DJANGO_DEBUG) { $env:DJANGO_DEBUG = "true" }
if (-not $env:ZOTERO20_API_KEY) { $env:ZOTERO20_API_KEY = "test-api-key" }
if (-not $env:ZOTERO_URL) { $env:ZOTERO_URL = "http://127.0.0.1:23119" }
$env:ZOTERO_WEB_API_KEY = ""

python -m pip install -q -r requirements.txt -r requirements-dev.txt

Write-Host "== pytest (unit + API z mockami Zotero) =="
python -m pytest @args -v --tb=short
