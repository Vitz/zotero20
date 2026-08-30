# Deployment na Raspberry Pi 5

## Wymagania

- Raspberry Pi 5, 8 GB RAM (minimum 4 GB)
- Raspberry Pi OS 64-bit lub Debian Bookworm arm64
- Konto Cloudflare z domeną
- Konto zotero.org

## 1. System

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git python3-venv python3-pip xvfb at-spi2-core libdbus-glib-1-2
```

Użytkownik dedykowany (opcjonalnie):

```bash
sudo useradd -m -s /bin/bash zotero
sudo loginctl enable-linger zotero
```

## 2. Instalacja Zotero 8 arm64

```bash
cd /tmp
curl -LO "https://www.zotero.org/download/client/dl?channel=release&platform=linux-arm64"
tar xf Zotero-*_linux-arm64.tar.bz2
sudo mv Zotero_linux-arm64 /opt/zotero
sudo ln -sf /opt/zotero/zotero /usr/local/bin/zotero
```

### Preferencje (po pierwszym uruchomieniu)

W Zotero: Edit → Settings → Advanced → Config Editor:

- `extensions.zotero.httpServer.enabled` = `true`
- `extensions.zotero.httpServer.port` = `23119`

Settings → Advanced → włącz „Allow other applications on this computer to communicate with Zotero”.

### Wtyczka zotero-api-plus

1. Pobierz najnowsze `.xpi` z [releases](https://github.com/GOKORURI007/zotero-api-plus/releases).
2. Zotero → Tools → Add-ons → Install Add-on From File.

### Test lokalny

```bash
curl -s http://127.0.0.1:23119/connector/ping
curl -s http://127.0.0.1:23119/api/plus/health
```

## 3. systemd (autostart)

Plik `~/.config/systemd/user/zotero.service`:

```ini
[Unit]
Description=Zotero Desktop
After=network.target

[Service]
Type=simple
Environment=DISPLAY=:99
ExecStartPre=/usr/bin/Xvfb :99 -screen 0 1024x768x24 &
ExecStart=/opt/zotero/zotero -ZoteroAPIEnabled
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now zotero
```

Dostosuj `ExecStart` jeśli Zotero wymaga innych flag na Twoim systemie.

## 4. cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
sudo mv cloudflared /usr/local/bin/
sudo chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login
cloudflared tunnel create zotero20
```

Skopiuj `server/cloudflared/config.yml.example` → `/etc/cloudflared/config.yml` i uzupełnij `tunnel` + `credentials-file`.

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

## 5. Cloudflare Access

1. Zero Trust → Access → Applications → Add application.
2. Self-hosted → hostname `zotero.twojadomena.pl`.
3. Policy: Service Auth — Service Token.
4. Utwórz Service Token; zapisz Client ID i Secret.
5. Powtórz dla `api.twojadomena.pl`.

## 6. Django (API importu)

```bash
cd /opt/zotero20/server/django
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Uzupełnij .env: ZOTERO_URL=http://127.0.0.1:23119, STUDIES_CONFIG=...
gunicorn zotero20.wsgi:application -b 127.0.0.1:8000
```

Unit systemd dla gunicorn — analogicznie do Zotero.

## 7. Smoke test end-to-end

```bash
export CF_ID=...
export CF_SECRET=...

# Zotero przez tunel
curl -H "CF-Access-Client-Id: $CF_ID" \
     -H "CF-Access-Client-Secret: $CF_SECRET" \
     https://zotero.twojadomena.pl/connector/ping

# Import DOI przez API
curl -X POST https://api.twojadomena.pl/api/v1/import/doi \
  -H "Content-Type: application/json" \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET" \
  -d '{"doi":"10.1038/nature12373","study":"badanie-1"}'
```

## 8. Kolekcje Zotero

Po utworzeniu kolekcji w UI Zotero:

```bash
curl -s http://127.0.0.1:23119/api/users/0/collections | jq '.[] | {key, name: .data.name}'
```

Wklej `key` do `server/django/config/studies.yaml`.

## Troubleshooting

| Problem | Sprawdź |
|---------|---------|
| `connection refused` na 23119 | `systemctl --user status zotero`, httpServer.enabled |
| CF 403 | Service Token, hostname w Access App |
| Connector nie łączy | `connector.url`, nagłówki CF w fork |
| Import OK, Refresh nie widzi | Ta sama instancja Zotero; nie Web API sync |
| Zotero pada po restarcie | Xvfb, linger, logi journalctl --user |
