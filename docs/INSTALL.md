# Install

## Requirements

- Node 22.6+ — it runs the TypeScript sources directly, so there is no build
  step and no toolchain to install
- An Anthropic API key
- A Netlify account, to deploy
- Docker, only if you want to self-host n8n instead of using n8n Cloud

## Local development

### 1. Backend

```bash
cd server
npm install
cp .env.example .env          # add your ANTHROPIC_API_KEY
node --experimental-strip-types --env-file=.env bin/serve.ts
curl http://localhost:8000/health
# {"status":"ok","sites":1}
```

The dev server runs the same router, service and prompt as production, with
two substitutions: state lives in memory instead of Netlify Blobs, and
undelivered leads are written to `server/var/spool/` where you can read them.
State therefore lasts as long as the process, which is what you want while
iterating on a prompt.

Without a webhook URL the backend still works end to end — qualified leads go
to the spool instead of n8n.

### 2. Widget

```bash
cd widget
node build.mjs          # writes dist/conserje.js
node serve-demo.mjs     # http://localhost:8080
```

Port 8080 is in `sites/carlosrendon.json`'s allowlist. On any other port the
backend returns 403 — that is the allowlist working.

### 3. n8n

See [N8N.md](N8N.md).

## Production

The backend deploys to Netlify as a function. `netlify.toml` at the repository
root holds the whole configuration, so the deploy needs no manual build
settings.

### First deploy

1. **Add new project → Import an existing project → GitHub**, and pick this
   repository. Netlify reads `netlify.toml` and fills in the build settings.
2. Add the environment variables below *before* the first deploy.
3. Deploy.

`https://<project>.netlify.app/health` should answer `{"status":"ok","sites":N}`.

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Boot fails without it, and every request answers 503 |
| `CONSERJE_WEBHOOK_SECRET` | yes | HMAC-SHA256 signing key for outbound leads |
| `CONSERJE_WEBHOOK_TOKEN` | no | Bearer token for receivers that cannot verify the HMAC — see [N8N.md](N8N.md) |
| `CONSERJE_WEBHOOK_<SITE>` | no | Where this site's leads go. Named by each site config's `webhookUrlEnv`. Leads spool until it is set |

Mark everything but the webhook URLs as secret. Netlify then keeps the value
out of build logs and scans deploys for it.

**Changing a variable does not affect a deployed function.** Netlify injects
them at deploy time, so a change needs **Deploys → Trigger deploy** to take
effect. This is the step that gets forgotten.

### Storage

Conversations, rate-limit windows and the lead spool live in Netlify Blobs.
Nothing to provision — the stores are created on first write.

Both the rate limiter and the conversation store read with
`consistency: 'strong'`. Blobs is eventually consistent by default, and with
the default a second request reads a stale window and the limiter refuses
callers nowhere near the limit, while a conversation lookup misses and starts
a fresh transcript mid-chat.

### Maintenance

`netlify/functions/maintenance.ts` runs hourly: it replays spooled leads and
drops conversations past their TTL. There is no cron to configure.

### Checking a deployment

```bash
server/bin/smoke.sh https://conserje-api.netlify.app carlosrendon https://carlosrendon.co
```

Exercises routing, the origin allowlist, input validation and whether anything
sensitive leaks into a response body, against a deployed URL. Exits non-zero on
the first failure, so it works as a deploy gate.
