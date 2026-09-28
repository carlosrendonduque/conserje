# Demo walkthrough

A guided tour of what Conserje does, one feature per section. Follow it to try
the product, or use it as a shot list when recording a screencast.

Conserje is not one screen. A lead starts as a conversation in a browser and
ends up as a phone notification, an email and a spreadsheet row, so most clips
cut between windows. Each section says which ones to have open.

*Versión en español: [demo.es.md](demo.es.md)*

## Setup, once

Clips 1–5 run against the live deployment: the chat on
[carlosrendon.co](https://carlosrendon.co), the backend on Netlify, the
workflow on n8n Cloud. Nothing needs to run locally for them.

Arrange these windows before you start recording:

| Window | What it shows |
|---|---|
| carlosrendon.co | The widget, bottom-right |
| Telegram (desktop or web) | The alerts, from the Conserje bot |
| A test inbox | The email the lead receives. Use an address that is not the sender's, so the email reads as it would for a real visitor |
| The CRM sheet | One row per lead |
| n8n → *Conserje - lead routing* → Executions | Which branch each lead took |

Clip 6 runs locally; its own setup is in that section.

## Reset, between takes

A conversation ends when the assistant records a lead, and a finished
conversation cannot be reopened. To start a fresh one, open the browser
console on carlosrendon.co and run:

```js
Conserje.reset()
```

Every take creates a real lead: a Telegram alert, an email, a sheet row. Delete
the test rows from the sheet when you are done. The rate limit is 60 messages
per visitor per hour, which is enough for several takes in a row.

---

## 1 · The conversation

**Shows:** a short conversation in place of a form, and the assistant asking
for exactly what is missing.

Open the widget and write, one message at a time, waiting for each reply:

1. `Hola, tengo una clínica dental y quiero un asistente en mi web que responda preguntas y agende citas automáticamente.`
2. `Ya tengo una web en WordPress, pero hoy todo lo hacemos por teléfono y WhatsApp a mano.`
3. `Es urgente, lo necesito esta semana: arranca una campaña de publicidad.`
4. `Tengo más de 40 mil dólares de presupuesto.`
5. `Me llamo Laura Gómez, mi correo es <test inbox>`

If the assistant asks in a different order, answer with whichever line fits.
After the last message it thanks the visitor and closes the conversation.

**The point:** the assistant asks for budget, timeline and contact because the
site config lists them, and it never quotes a price or a date, because the
site config tells it not to. The visitor sees none of the scoring.

---

## 2 · What arrives

**Shows:** the same lead landing in three places, seconds after the
conversation ends.

Straight after clip 1, cut to:

1. **Telegram.** *🔥 Hot lead from Carlos Rendon (score …)*, with the name,
   email, budget band, timeline and a summary written for the person who will
   follow up.
2. **The test inbox.** *Recibí tu mensaje — Carlos Rendon*, sent from Carlos's
   address. It quotes what the visitor asked for, in their words, not the
   internal summary. Replying goes straight to Carlos.
3. **The sheet.** A new row: tier, score, contact, the need, the full
   transcript, and `status` = `new`.

**The point:** the notification is for the person who has to act; the email
is for the visitor; the sheet is the record. None of them needed anyone to
copy anything across.

---

## 3 · Hot, warm, cold

**Shows:** routing by score, and that the score is computed, not guessed.

Run three conversations, resetting between them.

**Hot** — clip 1's conversation. Scores 85 or more.

**Warm:**
1. `Hi, I run a small online store and I'd like to automate order status emails and customer support replies.`
2. `We use Shopify, nothing custom built yet.`
3. `Next month would be ideal.`
4. `Budget is around 25k.`
5. `I'm James Carter, my email is <test inbox>`

**Cold:**
1. `Hola, solo estoy explorando qué se puede hacer con IA, sin nada concreto todavía.`
2. `No tengo presupuesto definido ni fecha, solo mirando.`
3. `Me llamo Pedro, pedro@example.com`

Then open n8n → Executions and click through the three runs:

| Tier | Branch | Telegram | Email | Sheet |
|---|---|---|---|---|
| Hot | Alert me now → Reply to hot lead | 🔥 Hot lead | "I will be in touch today" | Row |
| Warm | Alert me quietly → Reply to lead | New lead | "In the next few days" | Row |
| Cold | Hold for nurture | — | — | Row |

**The point:** the model extracts facts; the server scores them. Budget is
worth 45 points, timeline 30, reachability 15, context 10, and the thresholds
are per site. The same answers always land in the same tier, and the rules are
in `server/src/qualification/scorer.ts`, not in a prompt.

---

## 4 · Their language

**Shows:** the assistant and the email follow the visitor's language, not the
site's.

Carlos's site is configured in Spanish. Reset and repeat the warm conversation
from clip 3, in English. The assistant answers in English, and the email
arrives as *Got your message — Carlos Rendon*.

**The point:** the assistant records the visitor's language on the lead, and
the workflow picks the email template from it. One site config serves visitors
in either language.

---

## 5 · Nothing is lost

**Shows:** a lead survives n8n being down, and is delivered exactly once when
it comes back.

1. In n8n, open *Conserje - lead routing* and **unpublish** it.
2. Reset the widget and run the hot conversation from clip 1. The visitor gets
   the same sign-off as always; nothing on their side hints at a problem.
3. Show Telegram and the sheet: nothing arrived.
4. In Netlify → Logs → Functions → `chat`, show the line
   `lead delivery failed for site 'carlosrendon'`. The lead is now in the spool.
5. **Publish** the workflow again.
6. In Netlify → Logs → Functions → `maintenance`, select **Run now**, or wait
   for the top of the hour. The log reports `1 leads delivered, 0 still spooled`.
7. Cut to Telegram: the alert arrives, once.

**The point:** the visitor finished their part, so an outage downstream is
never their problem. A lead that cannot be delivered is spooled and replayed
hourly. The workflow answers as soon as it has authenticated the lead, so a
step that fails later cannot make the backend re-send it; and after 24 failed
replays a lead is set aside rather than retried forever.

---

## 6 · A second site

**Shows:** adding a client is a config file, not a code change.

This clip runs locally, against a fictional dental practice whose leads go to
the same n8n workflow.

**Setup.** Put these in `server/.env`, next to the `ANTHROPIC_API_KEY` that is
already there:

```bash
CONSERJE_WEBHOOK_TOKEN=<the same value as in Netlify>
CONSERJE_WEBHOOK_ACME=https://carlosrendon.app.n8n.cloud/webhook/conserje-lead
```

Then, in two terminals, start the backend against the example sites and the
widget demo server:

```bash
# terminal 1
cd server
CONSERJE_SITES_DIR=../examples/sites node --experimental-strip-types --env-file=.env bin/serve.ts

# terminal 2
cd widget
node build.mjs && node serve-demo.mjs
```

**Record:**

1. Open `examples/sites/acme-dental.json`. Point out `businessContext`,
   `collect`, the two budget bands, and `allowedOrigins`.
2. Generate its embed snippet:
   ```bash
   CONSERJE_SITES_DIR=examples/sites node --experimental-strip-types server/bin/print-embed.ts acme-dental \
     --endpoint=http://localhost:8000/chat --script=/dist/conserje.js
   ```
3. Open <http://localhost:8080/demo/acme-dental.html>. The same widget, a
   different greeting, a different business.
4. Have the conversation:
   1. `Hi, I cracked a crown last night and it really hurts.`
   2. `I'd like a full plan this time: the crown, and whatever else it turns out to need.`
   3. `As soon as possible, this week if you can.`
   4. `Maria Lopez, 0412 345 678, <test inbox>`
5. Cut to Telegram: *🔥 Hot lead from Acme Dental*. In the sheet, the new row
   has `acme-dental` in the `site` column.

**The point:** everything that makes this a dental practice rather than a
consultancy — what it offers, what to ask, what "hot" means, which origins may
embed it, where its leads go — lives in one JSON file. The code is shared.
