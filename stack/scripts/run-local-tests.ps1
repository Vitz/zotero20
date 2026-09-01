# Lokalne testy zotero20 na Windows (Docker + pytest).
# Użycie:
#   .\stack\scripts\run-local-tests.ps1
#   .\stack\scripts\run-local-tests.ps1 -Rebuild
#   .\stack\scripts\run-local-tests.ps1 -StackOnly   # tylko stack/ (GHCR), port 8089
#   .\stack\scripts\run-local-tests.ps1 -UnitOnly    # tylko pytest bez Dockera

param(
    [switch]$Rebuild,
    [switch]$StackOnly,
    [switch]$UnitOnly,
    [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$StackDir = Join-Path $RepoRoot "stack"
$ServerDir = Join-Path $RepoRoot "server"
$DjangoDir = Join-Path $ServerDir "django"
$EnvFile = Join-Path $StackDir ".env"
$EnvExample = Join-Path $StackDir ".env.example"

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

if (-not (Test-Path $EnvFile)) {
    Write-Step "Tworzenie stack/.env z .env.example"
    if (-not (Test-Path $EnvExample)) { throw "Brak $EnvExample" }
    Copy-Item $EnvExample $EnvFile
    Write-Host "Uzupełnij ZOTERO20_API_KEY w $EnvFile i uruchom ponownie." -ForegroundColor Yellow
    exit 1
}

# Wczytaj .env (prosty parser KEY=VALUE)
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$' -and $_ -notmatch '^\s*#') {
        $name = $matches[1]
        $value = $matches[2].Trim().Trim('"').Trim("'")
        Set-Item -Path "env:$name" -Value $value
    }
}

if (-not $env:ZOTERO20_API_KEY) {
    throw "Brak ZOTERO20_API_KEY w $EnvFile"
}

if ($Port -eq 0) {
    $Port = if ($env:ZOTERO20_HOST_PORT) { [int]$env:ZOTERO20_HOST_PORT } else { 8089 }
}

$BaseUrl = "http://127.0.0.1:$Port"
$env:ZOTERO_BASE = $BaseUrl
$env:ZOTERO20_HOST_PORT = "$Port"

# --- Unit tests (pytest, mock Zotero) ---
Write-Step "pytest (unit, mock Zotero)"
Push-Location $DjangoDir
try {
    python -m pip install -q -r requirements-dev.txt 2>$null
    python -m pytest tests/ -m "not integration" -q
    if ($LASTEXITCODE -ne 0) { throw "pytest unit failed" }
}
finally {
    Pop-Location
}

if ($UnitOnly) {
    Write-Host "`nUnit tests OK (pominięto Docker)." -ForegroundColor Green
    exit 0
}

# --- Docker stack ---
if ($StackOnly) {
    Write-Step "docker compose (stack/, GHCR) port $Port"
    Push-Location $StackDir
    try {
        $studiesYaml = Join-Path $StackDir "config\studies.yaml"
        $studiesExample = Join-Path $StackDir "config\studies.yaml.example"
        if (-not (Test-Path $studiesYaml)) {
            Copy-Item $studiesExample $studiesYaml
        }
        if ($Rebuild) {
            docker compose -p zotero20 pull
        }
        docker compose -p zotero20 up -d
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Step "docker compose (server/, build lokalny) port $Port"
    $env:ZOTERO20_HOST_PORT = if ($Port -ne 8089) { "$Port" } else { "8000" }
    $Port = [int]$env:ZOTERO20_HOST_PORT
    $BaseUrl = "http://127.0.0.1:$Port"
    $env:ZOTERO_BASE = $BaseUrl

    Push-Location $ServerDir
    try {
        $studiesYaml = Join-Path $DjangoDir "config\studies.yaml"
        $studiesExample = Join-Path $DjangoDir "config\studies.yaml.example"
        if (-not (Test-Path $studiesYaml)) {
            Copy-Item $studiesExample $studiesYaml
        }
        $composeArgs = @("compose", "-p", "zotero20-dev", "up", "-d")
        if ($Rebuild) { $composeArgs = @("compose", "-p", "zotero20-dev", "up", "-d", "--build") }
        docker @composeArgs
    }
    finally {
        Pop-Location
    }
}

# --- Czekaj na health ---
Write-Step "Czekam na $BaseUrl/api/v1/health"
$deadline = (Get-Date).AddMinutes(6)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-RestMethod -Uri "$BaseUrl/api/v1/health" -TimeoutSec 10
        if ($r.service -eq "zotero20-api") {
            $healthy = $true
            break
        }
    }
    catch { }
    Start-Sleep -Seconds 5
}
if (-not $healthy) { throw "Stack nie odpowiada na $BaseUrl/api/v1/health w czasie 6 min" }

# --- Integration pytest ---
Write-Step "pytest (integration, Docker)"
Push-Location $DjangoDir
try {
    $env:ZOTERO20_INTEGRATION = "1"
    python -m pytest tests/integration/test_stack.py -m integration -q
    if ($LASTEXITCODE -ne 0) { throw "pytest integration failed" }
}
finally {
    Pop-Location
}

# --- Bash smoke (Git Bash / WSL) ---
$bash = Get-Command bash -ErrorAction SilentlyContinue
if ($bash) {
    Write-Step "integration-test.sh"
    $env:ZOTERO_BASE = $BaseUrl
    & bash (Join-Path $StackDir "scripts\integration-test.sh")
    if ($LASTEXITCODE -ne 0) { throw "integration-test.sh failed" }
}
else {
    Write-Host "bash niedostępny — pominięto integration-test.sh (pytest integration wystarczy)." -ForegroundColor Yellow
}

Write-Host "`nWszystkie testy zakończone sukcesem." -ForegroundColor Green
Write-Host "Ponowne uruchomienie: .\stack\scripts\run-local-tests.ps1"
Write-Host "Tylko unit:           .\stack\scripts\run-local-tests.ps1 -UnitOnly"
Write-Host "Rebuild + integracja: .\stack\scripts\run-local-tests.ps1 -Rebuild"
