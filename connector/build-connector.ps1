# Build Zotero20 Connector via Docker (Windows-friendly).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Building connector image..."
docker compose build connector

Write-Host "Running connector build (Chrome MV3 + Firefox MV2)..."
docker compose run --rm connector

$chromeManifest = Join-Path $PSScriptRoot "upstream\build\manifestv3\manifest.json"
$firefoxManifest = Join-Path $PSScriptRoot "upstream\build\firefox\manifest.json"
if (-not (Test-Path $chromeManifest)) {
    throw "Build failed - missing $chromeManifest"
}
if (-not (Test-Path $firefoxManifest)) {
    throw "Build failed - missing $firefoxManifest"
}

Write-Host ""
Write-Host "Chrome -> Load unpacked:"
Write-Host "  $((Join-Path $PSScriptRoot 'upstream\build\manifestv3'))"
Write-Host ""
Write-Host "Firefox -> about:debugging -> Load Temporary Add-on:"
Write-Host "  $((Join-Path $PSScriptRoot 'upstream\build\firefox'))"
$xpi = Join-Path $PSScriptRoot "upstream\build\zotero20-connector-firefox.xpi"
if (Test-Path $xpi) {
    Write-Host "  lub XPI: $xpi"
}
