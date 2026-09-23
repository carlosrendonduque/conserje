# Architecture

## The shape of one turn

```
POST /chat?site=acme
  │
  ├─ site lookup ............ unknown site and disallowed origin return the
  │                           same 403, so the endpoint cannot be used to
  │                           enumerate tenants
  ├─ CORS ................... exact-match allowlist, per site
  ├─ rate limit ............. per site and IP, before any spend
  ├─ body validation ........ length cap, empty check
  │
  ├─ ChatService ............ loads or starts the conversation
  │    ├─ turn cap .......... checked before the model call, not after
  │    ├─ ChatModel ......... the only seam to the provider
  │    ├─ LeadScorer ........ deterministic, server-side
  │    └─ LeadDeliverer ..... signed POST, spooled on failure
  │
  └─ JSON response .......... session id, reply, done flag. Nothing else.
```

## Why the pieces are where they are

**Conversation state is server-side.** The browser holds a 32-character hex
session id and nothing more. If the transcript lived in the client, a visitor
could rewrite history, replay a finished conversation, or hand the backend a
fabricated lead. `FileConversationStore` keeps it on disk; the `ConversationStore`
interface exists so that becomes Redis or Postgres without touching the service.

**`ChatModel` is a one-method interface.** Every test in the suite runs against
`FakeChatModel`. The qualification flow — limits, tenant isolation, scoring,
delivery, failure paths — is verified without a network call or a cent of
spend. It also means swapping providers never reaches into `ChatService`.

**Scoring is code, not prompt.** `LeadScorer` reads the extracted facts and
produces a number. Asking the model to score its own lead would make routing
non-deterministic, unreviewable, and trivially gameable by a visitor who
figures out what to say. The weights are in one class with tests around them.

**The tool schema is strict.** `record_lead` sets `strict: true` with
`additionalProperties: false` and every property in `required`. The payload
goes straight into automation, where a missing key is a broken workflow run
rather than a cosmetic problem. Optional fields are typed `["string", "null"]`
so the model has a way to say "not given" without inventing something.

**The tool loop closes properly.** When the model calls `record_lead`, the
backend returns a `tool_result` and makes one more request so the sign-off is
written by the model in the visitor's language, rather than stitched from a
template that would only ever be right in one locale.

## Prompt caching

`tools` and `system` render ahead of `messages`, so the request prefix is:

```
[ tool definition ][ system prompt ]│[ conversation so far ]
                                    └── cache breakpoint
```

`PromptBuilder` renders both halves from site config alone, with no
per-request data mixed in. That makes the prefix byte-identical for every
visitor on a site, so consecutive conversations read it from cache instead of
paying full price. `PromptBuilderTest::the_rendered_prefix_is_byte_stable`
guards this — the usual way to break it is interpolating a timestamp or a
visitor name into the system prompt, which looks harmless and silently ends
caching.

`Usage` carries `cacheReadInputTokens` for the same reason: if it stays at
zero across consecutive visitors, something has broken the prefix.

## Model and effort

The default is `claude-opus-5`, overridable per site with the `model` key.

Effort is pinned to `low`. Qualification is a short exchange where the visitor
is watching a typing indicator, and thinking depth buys little on a task this
shaped. Thinking itself stays on: disabling it on this model tier causes tool
calls to leak into visible text, which here would mean the assistant *saying*
it recorded a lead while no `tool_use` block was ever emitted.

To trade quality for cost, set `"model": "claude-haiku-4-5"` on a site. That is
a per-site decision because a dental practice and a consultancy do not need the
same judgment from their front desk.

## Failure behaviour

| Failure | What happens |
|---|---|
| Model call fails | 503 with a `retryable` flag; the visitor's turn is **not** persisted, so a retry replays it rather than duplicating it |
| n8n unreachable | Lead is spooled to `var/spool/`; the visitor still gets their sign-off |
| Webhook rejects | Same — spooled, retried hourly by the maintenance function |
| Corrupt session file | Treated as absent; the visitor gets a fresh session instead of a 500 |
| Rate-limit file unwritable | Fails **closed**; a broken limiter does not become a free pass to a paid API |
| Boot misconfiguration | 503 with no detail; the real reason goes to the error log, because the message could name an env var or a path |

## Layout

```
server/
├── netlify/functions/
│   ├── chat.ts              the platform adapter -- four lines over the router
│   └── maintenance.ts       hourly: replay the spool, purge expired transcripts
├── bin/                     dev server, embed snippet, deploy smoke test
└── src/
    ├── app.ts               wiring, cached per cold start
    ├── chat/                the orchestrator and its errors
    ├── config/              site configs, loaded and validated once
    ├── conversation/        transcript state and its store
    ├── http/                the router, CORS, JSON responses
    ├── llm/                 the provider seam and the Claude implementation
    ├── qualification/       prompt, tool schema, lead, scoring
    ├── ratelimit/           sliding-window limiter
    ├── support/             clock, lazy store handles
    └── webhook/             payload contract, signing, delivery, spooling
```

The router is a plain `Request -> Response` function and the platform adapter
sits outside it, so routing, the origin allowlist, input validation and error
bodies are all unit-testable without a platform around them.

Storage is behind interfaces with two implementations each: Netlify Blobs in
production, in-memory for tests and the dev server. That is what lets the
suite run with no network and no credentials.
