# Conserje

An embeddable chat widget that qualifies website visitors and routes them as
scored leads through n8n.

A contact form tells you someone typed an email address. It does not tell you
whether they have a budget, a deadline, or a problem you can actually solve.
Conserje has a short conversation instead, extracts a structured brief, scores
it, and sends it where it needs to go — a notification for the leads worth
dropping everything for, a spreadsheet row for the rest.

```
 Visitor ──▶ Widget ──▶ PHP backend ──▶ Claude
  (browser)  (shadow    (holds the      (conversation +
              DOM)       API key)        structured extraction)
                             │
                             ▼
                      signed webhook
                             │
                             ▼
                           n8n ──▶ notify · email · calendar · CRM
```

The widget never sees a credential, a prompt, or a score. It posts a message
and an opaque session id, and renders what comes back.

## What is in the box

| Directory  | What it holds |
|------------|---------------|
| `widget/`  | The embeddable widget. Vanilla JS in a shadow root, no dependencies, 15.5 KB built. |
| `backend/` | PHP 8.2+. Holds the API key, drives the conversation, scores leads, signs webhooks. |
| `sites/`   | One JSON file per site. Adding a client is a config file, not a code change. |
| `n8n/`     | Self-hosted n8n via Docker Compose, plus the workflows as version-controlled JSON. |
| `docs/`    | Install, architecture, security, and the n8n setup. |

## Quick start

```bash
# 1. Backend
cd backend
composer install
cp .env.example .env          # add your ANTHROPIC_API_KEY
php -S localhost:8000 -t public

# 2. Widget
cd ../widget
node build.mjs
node serve-demo.mjs           # http://localhost:8080

# 3. n8n (optional for a first look)
cd ../n8n
cp .env.example .env          # add the same CONSERJE_WEBHOOK_SECRET
docker compose up -d          # http://localhost:5678
```

Full walkthrough in [docs/INSTALL.md](docs/INSTALL.md).

## Adding a site

Drop a JSON file in `sites/`. The filename must match the `id` inside it.

```jsonc
{
  "id": "acme-dental",
  "name": "Acme Dental",
  "locale": "en",
  "allowedOrigins": ["https://acmedental.example"],
  "greeting": "Hi — what brings you in?",
  "businessContext": "Acme fits crowns and does implants. No orthodontics.",
  "collect": ["What is bothering them", "How soon", "A name and a phone number"],
  "budgetBands": ["single-treatment", "full-plan"],
  "webhookUrlEnv": "CONSERJE_WEBHOOK_ACME",
  "hotScoreThreshold": 70,
  "warmScoreThreshold": 40
}
```

Then generate the embed snippet, so the page and the backend cannot disagree
about the greeting or the locale:

```bash
php backend/bin/print-embed.php acme-dental \
  --endpoint=https://api.example.com/chat \
  --script=https://cdn.example.com/conserje.js
```

`businessContext` is the one field worth writing carefully. The assistant will
only claim what that paragraph supports, so a vague description produces a
vague assistant and a wrong one produces confident wrong answers.

## Scoring

Each lead gets a 0–100 score, computed on the server from the extracted facts:

| Signal | Weight | How it is read |
|---|---|---|
| Budget | 45 | Position of the stated band in `budgetBands`, low to high |
| Timeline | 30 | Urgent beats soon beats stated beats vague beats silent |
| Reachability | 15 | Email and phone beats one of them beats neither |
| Context | 10 | A named company, and a brief specific enough to act on |

The score is computed in code rather than asked for. A model asked to return a
number will drift between runs; routing rules should be reviewable in a diff
and covered by tests. See `backend/src/Qualification/LeadScorer.php`.

Thresholds are per site, so "hot" for a dental practice and "hot" for an agency
can mean different things.

## Tests

```bash
cd backend && ./vendor/bin/phpunit      # 81 tests
cd n8n && npm test                      # signature contract, PHP vs n8n
```

The n8n suite is worth a note: the HMAC rule is implemented twice, once in PHP
and once as JavaScript inside an n8n Code node. The test extracts that Code
node straight out of the exported workflow JSON and runs it against signatures
produced by the real PHP class. If either side drifts, CI fails instead of
leads silently disappearing.

## Security

The short version:

- The API key lives in the backend process environment and nowhere else.
- Each site declares the exact origins allowed to embed it. No wildcards, no
  suffix matching.
- Conversation state is server-side; the browser holds only an opaque id.
- Leads are signed with HMAC-SHA256 over `timestamp.body`, so a captured
  request cannot be replayed.
- Rate limiting is per site and IP, enforced before any model call.
- A lead that cannot be delivered is spooled to disk rather than lost.

The long version, including what is deliberately *not* defended against, is in
[docs/SECURITY.md](docs/SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

## Checking a deployment

```bash
backend/bin/smoke.sh https://api.example.com carlos-portfolio https://your-site.example
```

Exercises routing, the origin allowlist, input validation, and whether
anything sensitive leaks into a response body — the things a vhost gets wrong
and a unit test cannot see. Exits non-zero on the first failure, so it works as
a deploy gate.
