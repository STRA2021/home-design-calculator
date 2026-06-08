# Home Design Cost Calculator

A Hebrew (RTL) landing page that gives an instant home-design cost estimate and
captures the lead.

## How leads are handled (secure)

The browser **never** talks to your Make/Zapier webhook directly. Instead:

1. [calculator.html](calculator.html) POSTs the lead to `/api/lead`.
2. [api/lead.js](api/lead.js) (a Vercel serverless function) validates it,
   blocks bots, and forwards it to your webhook.

The webhook URL lives only on the server, in an environment variable, so it is
never exposed in the page source.

### Protections in `api/lead.js`

- **Server-side validation** — name, phone, email, consent are re-checked (client
  validation is UX only and can be bypassed).
- **Honeypot** — a hidden `company` field; if filled, the submission is silently
  dropped (bots fill it, humans don't).
- **Rate limiting** — best-effort ~5 requests/min per IP. Serverless instances are
  ephemeral and not shared, so for a hard guarantee use an external store
  (Vercel KV / Upstash Redis).
- **Payload sanitization** — project type, tier, area, categories and estimate are
  whitelisted/clamped before forwarding (never trust the client).

## Deploy on Vercel

1. Push this repo to Vercel (it auto-detects `api/` functions and static files).
2. In **Settings → Environment Variables**, add:

   | Name          | Value                                  |
   | ------------- | -------------------------------------- |
   | `WEBHOOK_URL` | your Make/Zapier webhook URL           |

   Add it for **Production** (and Preview/Development if you test there).
3. Redeploy so the new env var takes effect.

## Local development

```bash
npm i -g vercel
vercel dev          # serves the page + /api/lead locally
```

Create a `.env.local` (gitignored) with `WEBHOOK_URL=...` for local testing.
