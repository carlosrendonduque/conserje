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
CONSERJE_WEBHOOK_SECRET=     # must match the backend's value byte for byte
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
Lead webhook → Authenticate → Route by tier ┬─ hot  → Alert me now → Send booking link ─┐
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

**The credential never lives in the node.** How the request is authenticated
depends on what the host allows the Code node to read:

| Host | Mechanism | Where the secret lives |
|---|---|---|
| Self-hosted | HMAC signature | `$env`, from `n8n/.env` via `docker-compose.yml` |
| n8n Cloud, paid | HMAC signature | `$vars`, Settings → Variables |
| n8n Cloud, free | Header Auth | a credential, checked by the Webhook node |

`Authenticate` tries the signature first and only falls back to trusting the
token header, which the Webhook node has already validated by then. With
neither available it throws: a verifier that waves requests along when it
cannot verify them is worse than no verifier, because it looks like one. A
contract test asserts the Webhook node still requires Header Auth, so the
fail-open configuration cannot ship.

Header Auth is weaker than the signature -- it does not cover the body and
carries no timestamp, so a captured request stays replayable. Over TLS that
leaves only an attacker who already holds the token, which is the same position
a leaked signing secret would create.

**`crypto` is allow-listed for Code nodes.** The Code node sandbox blocks every
Node builtin unless it is named in `NODE_FUNCTION_ALLOW_BUILTIN`, which
`docker-compose.yml` now sets. Without it `Verify signature` throws
`Module 'crypto' is disallowed`, the webhook returns 500, and the backend
spools the lead — indistinguishable, from the outside, from a bad secret.

## Environment the workflows expect

Beyond the secret, set these in `n8n/.env`. `docker-compose.yml` passes them
through to the container, where the nodes read them as `$env.NAME`:

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

If nothing arrives, the lead is in the spool rather than lost. Each spooled
record names the reason delivery failed. Locally that is `server/var/spool/`;
in production it is the `conserje-spool` blob store, and
`netlify/functions/maintenance.ts` retries it hourly — fix the cause and the
next run delivers it. The function log line says how many were delivered and
how many are still waiting.

## Editing a workflow

Workflows are version-controlled. After changing one in the UI, export it back
over the file in `workflows/` so the repository stays the source of truth:

**Workflow → ⋯ → Download**, then commit the result.

If you change `Authenticate`, run `npm test` in `n8n/` before committing —
it checks that node against the PHP implementation and will catch a drift that
would otherwise only show up as leads silently disappearing.
