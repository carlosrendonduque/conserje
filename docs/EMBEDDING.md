# Embedding the widget

A brief for whoever is building the host page.

## What you are integrating

One `<script>` tag. There is no npm package, no React component, no build
step to share, and no CSS to import.

At runtime the widget appends **a single element** to `<body>` and renders
everything inside a shadow root. It cannot inherit your styles and your styles
cannot reach it. It does not read or modify the rest of the page.

Built size is 15.5 KB, loaded with `defer`, so it never blocks rendering.

## The tag

```html
<script src="/conserje.js"
        data-endpoint="https://api.example.com/chat"
        data-site="your-site-id"
        data-title="Your Name"
        data-greeting="Hi — what are you working on?"
        data-locale="en"
        defer></script>
```

Generate it rather than writing it by hand, so the page and the backend cannot
disagree about the greeting or the locale:

```bash
php backend/bin/print-embed.php your-site-id \
  --endpoint=https://api.example.com/chat \
  --script=https://your-site.example/conserje.js
```

### Attributes

| Attribute | Required | Notes |
|---|---|---|
| `data-endpoint` | yes | Full URL of the backend's `/chat` route |
| `data-site` | yes | Site id; must match a file in `sites/` |
| `data-title` | no | Shown in the panel header |
| `data-greeting` | no | First message, rendered before any request |
| `data-locale` | no | `en` or `es`; falls back to `<html lang>` |
| `data-accent` | no | Any CSS color; sets the button and bubble color |
| `data-theme` | no | `light` or `dark` to force one; omit to follow the system |

Both required attributes missing is the only failure mode: the widget logs to
the console and renders nothing.

## Rules that matter

**Put the tag in the HTML document, not in a component.** The widget is a
one-shot IIFE that reads `document.currentScript` at load. In a React or Vue
app it belongs in `index.html`, exactly once. Importing it from a component, or
mounting it in an effect, will not work — and in a component that remounts it
would try to attach itself twice.

**The page must be served from an allowlisted origin.** Each site config lists
the exact origins allowed to embed it. A page on any other origin gets a 403.
That includes your dev server: add `http://localhost:5173` (or whatever port
you use) to `allowedOrigins` while developing.

**Do not also build a contact form.** The widget replaces it. Two ways to get
in touch on one page means visitors pick the lower-effort one, and a form
tells you nothing about whether the person has a budget or a deadline. If the
page needs a fallback for people who will not chat, make it a plain `mailto:`
link in the footer, not a second form competing for the same click.

## Wiring your own buttons

The widget exposes a small API on `window` once loaded:

```js
window.Conserje.open();    // open the panel
window.Conserje.close();   // close it
window.Conserje.reset();   // clear the stored session and start over
```

Use `open()` on the page's real calls to action. A "Work with me" button in the
hero that opens the chat converts far better than a launcher nobody notices:

```html
<button type="button" onclick="window.Conserje.open()">Work with me</button>
```

Guard it if the button can render before the script loads:

```js
button.addEventListener('click', () => window.Conserje?.open());
```

## What the page should say

The assistant and the page have to tell the same story. If the page says you
build AI products and the assistant has never heard of that, the visitor
notices immediately.

The `businessContext` field in the site config is what the assistant knows.
Write it from the same material as the page's About section: what you do, who
you do it for, what you explicitly do not take on, and anything the assistant
must never promise — prices, delivery dates, availability.

That last part is the one people skip. The assistant will only claim what that
paragraph supports, so a vague description produces a vague assistant, and a
wrong one produces confident wrong answers.

## Local development

```
Landing page   http://localhost:5173   (your dev server)
Backend        http://localhost:8000   (php -S localhost:8000 -t backend/public)
```

Point `data-endpoint` at `http://localhost:8000/chat` and add your dev server's
origin to `allowedOrigins`. Nothing else changes between dev and production
except those two values.

## Checklist

- [ ] Script tag is in the HTML document, before `</body>`, exactly once
- [ ] `data-endpoint` and `data-site` are set
- [ ] The page's origin is in the site's `allowedOrigins`
- [ ] `conserje.js` is served from somewhere the page can reach
- [ ] Calls to action call `window.Conserje.open()`
- [ ] There is no competing contact form
- [ ] `businessContext` in the site config matches what the page claims
