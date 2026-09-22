# n8n

## Start it

```bash
cd n8n
cp .env.example .env
```

Fill in `.env`:

```ini
POSTGRES_PASSWORD=...
N8N_ENCRYPTION_KEY=          # openssl rand -hex 32 -- back this up
CONSERJE_WEBHOOK_SECRET=     # must match backend/.env byte for byte
```

```bash
docker compose up -d
open http://localhost:5678
```

The port binds to `127.0.0.1` only. To expose it, put a reverse proxy with TLS
in front and set `N8N_HOST`, `N8N_PROTOCOL` and `WEBHOOK_URL` to the public
values — otherwise n8n registers webhook URLs pointing at localhost.

## Import the workflows

**Workflows → Import from File**, once per file in `workflows/`.

| Workflow | Trigger | What it does |
|---|---|---|
| `lead-routing.json` | Webhook `POST /webhook/conserje-lead` | Verifies the signature, routes by tier, notifies, emails, appends to the sheet |
| `stale-lead-followup.json` | Weekdays 09:00 | Finds leads logged but never followed up, nudges them, marks them chased |

### lead-routing

```
Lead webhook → Verify signature → Route by tier ┬─ hot  → Alert me now → Send booking link ─┐
                                                ├─ warm → Alert me quietly → Acknowledge ───┤
                                                └─ cold → Hold for nurture ─────────────────┤
                                                                                            ▼
                                             Respond OK ← Append to CRM sheet ← Flatten for CRM
```

Two things about this workflow are load-bearing:

**Raw Body is enabled on the webhook node.** The signature covers the exact
bytes that were sent. n8n's parsed object would re-serialise with different key
order or spacing and every signature would fail. The contract test asserts this
setting is still on.

**The secret comes from the environment, not the node.** `Verify signature`
reads `$env.CONSERJE_WEBHOOK_SECRET`, which is why `docker-compose.yml` sets
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. Pasting the secret into the node would
put it in the exported JSON in this repository.

If the Code node reports that `crypto` is unavailable, set
`NODE_FUNCTION_ALLOW_BUILTIN=crypto` in the n8n service environment and
restart.

## Environment the workflows expect

Beyond the secret, set these on the n8n container for the nodes to resolve:

```ini
TELEGRAM_CHAT_ID=...              # where hot-lead alerts go
CONSERJE_FROM_EMAIL=...           # sender for the outbound emails
CONSERJE_BOOKING_URL=...          # Cal.com / Calendly link for hot leads
CONSERJE_SHEET_ID=...             # Google Sheet used as the lead log
```

## Credentials

Three, configured in the n8n UI, never in the JSON:

- **SMTP** for the `emailSend` nodes
- **Telegram** for the alert nodes
- **Google Sheets OAuth2** for the CRM nodes

The exports reference credentials by type, so n8n asks you to pick one on
import instead of carrying anything sensitive in this repository.

## The lead sheet

Create a sheet with a tab named `Leads` and this header row. `Flatten for CRM`
maps onto these names, and `conversationId` is what the follow-up workflow uses
to find a row again:

```
receivedAt  site  tier  score  name  email  phone  company  need
timeline  budgetBand  summary  turns  conversationId  transcript  status
```

`status` starts at `new`. The follow-up workflow only touches rows still
marked `new`, so anything a human moves on to — `contacted`, `won`, `dropped` —
is left alone.

## Testing end to end

With the backend and n8n both running, drive a conversation through the widget
until the assistant records a lead. Then check, in order:

1. **n8n → Executions.** A successful run of *Conserje - lead routing*.
2. **The sheet.** One new row, `status` = `new`.
3. **Telegram / email**, if the lead scored warm or hot.

If nothing arrives, look in `backend/var/spool/`. Each spooled file names the
reason delivery failed. Fix it, then:

```bash
php backend/bin/retry-spool.php --dry-run   # what would be sent
php backend/bin/retry-spool.php             # send it
```

## Editing a workflow

Workflows are version-controlled. After changing one in the UI, export it back
over the file in `workflows/` so the repository stays the source of truth:

**Workflow → ⋯ → Download**, then commit the result.

If you change `Verify signature`, run `npm test` in `n8n/` before committing —
it checks that node against the PHP implementation and will catch a drift that
would otherwise only show up as leads silently disappearing.
