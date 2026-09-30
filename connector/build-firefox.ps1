# Build Zotero20 Connector for Firefox via Docker (Windows-friendly).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Building connector image..."
docker compose build connector

Write-Host "Running connector build (Chrome MV3 + Firefox MV2)..."
docker compose run --rm connector

$firefoxManifest = Join-Path $PSScriptRoot "upstream\build\firefox\manifest.json"
if (-not (Test-Path $firefoxManifest)) {
    throw "Build failed - missing $firefoxManifest"
}

$firefoxDir = Join-Path $PSScriptRoot "upstream\build\firefox"
$xpi = Join-Path $PSScriptRoot "upstream\build\zotero20-connector-firefox.xpi"

Write-Host ""
Write-Host "Firefox -> about:debugging -> Load Temporary Add-on:"
Write-Host "  $firefoxDir"
if (Test-Path $xpi) {
    Write-Host "  lub XPI: $xpi"
}
