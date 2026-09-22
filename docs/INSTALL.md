# Install

## Requirements

- PHP 8.2+ with `json`, `curl`, `mbstring`
- Composer
- Node 22+ (only to build the widget and run the n8n tests)
- Docker (only for self-hosted n8n)
- An Anthropic API key

## Local development

### 1. Backend

```bash
cd backend
composer install
cp .env.example .env
```

Fill in `.env`:

```ini
ANTHROPIC_API_KEY=sk-ant-...
CONSERJE_WEBHOOK_SECRET=       # openssl rand -hex 32
CONSERJE_WEBHOOK_CARLOS_PORTFOLIO=http://localhost:5678/webhook/conserje-lead
```

Start it:

```bash
php -S localhost:8000 -t public
curl http://localhost:8000/health
# {"status":"ok","sites":1}
```

Without a webhook URL the backend still works end to end — qualified leads go
to the spool directory instead of n8n, and `bin/retry-spool.php` replays them
once a URL exists.

### 2. Widget

```bash
cd widget
node build.mjs          # writes dist/conserje.js
node serve-demo.mjs     # http://localhost:8080
```

Port 8080 is in `sites/carlosrendon.json`'s allowlist. On any other port
the backend returns 403 — that is the allowlist working.

### 3. n8n

See [N8N.md](N8N.md).

## Production

### Directory layout

Only `backend/public/` may be reachable over HTTP.

```
/srv/conserje/
├── backend/
│   ├── public/          ← document root
│   ├── src/  vendor/  bin/
│   ├── var/             ← writable, NOT under public/
│   └── .env             ← 0600
└── sites/
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    root /srv/conserje/backend/public;
    index index.php;

    location / {
        try_files $uri /index.php$is_args$args;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root/index.php;
        include fastcgi_params;
    }

    # Nothing outside public/ is served, but say so explicitly.
    location ~ /\. { deny all; }
}
```

### Apache

`public/.htaccess`:

```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteRule ^ index.php [QSA,L]
</IfModule>
```

Point `DocumentRoot` at `backend/public`, and confirm `AllowOverride All` is
set for it.

### Permissions

```bash
chmod 600 backend/.env
mkdir -p backend/var
chown www-data:www-data backend/var
chmod 750 backend/var
```

Verify the obvious mistake is not live:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/../.env
# anything other than 403/404 means the document root is wrong
```

### Behind a proxy or CDN

Set `CONSERJE_TRUST_PROXY=true` **only** when a proxy you control rewrites
`X-Forwarded-For`. Otherwise any client can hand itself a fresh rate-limit
bucket per request.

### Hosting the widget

`widget/dist/conserje.js` is a static file. Serve it from the same origin as
the host site, or any CDN. It contains no secrets and is identical for every
site — the per-site configuration is in the `data-` attributes.

Generate the snippet rather than writing it by hand:

```bash
php backend/bin/print-embed.php carlosrendon \
  --endpoint=https://api.example.com/chat \
  --script=https://cdn.example.com/conserje.js
```

#### WordPress

Paste the snippet into **Appearance → Theme File Editor → footer.php** before
`</body>`, or use a "insert headers and footers" plugin. Nothing else is
needed: the widget creates its own element and does not touch the page's DOM
or styles.

### Cron

```cron
*/5 * * * *  cd /srv/conserje/backend && php bin/retry-spool.php >> var/spool.log 2>&1
17 4 * * *   cd /srv/conserje/backend && php bin/purge-conversations.php --days=7
```

The first replays anything n8n was unavailable for. The second deletes
transcripts past the retention window.

## Troubleshooting

| Symptom | Cause |
|---|---|
| 403 on every request | The page's origin is not in the site's `allowedOrigins`, or the `site` query parameter is wrong |
| 503 on every request | Boot failure — check the PHP error log; usually a missing `ANTHROPIC_API_KEY` or an unreadable `sites/` |
| 429 immediately | `var/ratelimit` is not writable; the limiter fails closed by design |
| Leads never arrive in n8n | Check `var/spool/` — each file names the reason it failed |
| `cacheReadInputTokens` always 0 | Something made the system prompt vary per request; see ARCHITECTURE.md |
| Widget renders nothing | `data-endpoint` or `data-site` missing; the console says which |
