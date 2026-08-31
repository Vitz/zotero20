# Zotero20 Connector (fork)

Jeden host: `https://zotero.keyweb.pl` + nagłówek **X-API-Key**.

## Build

```bash
cd connector
./setup.sh
cd upstream && npm install && npm run build
```

Chrome → Load unpacked → folder buildu.

## Konfiguracja wtyczki (Options / about:config)

| Pref | Wartość |
|------|---------|
| `connector.url` | `https://zotero.keyweb.pl` |
| `zotero20.apiKey` | ten sam co `ZOTERO20_API_KEY` w `.env` |

Wszystkie requesty (Connector ping, cytowania Docs) przechodzą przez Django gateway.
