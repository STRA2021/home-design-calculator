/* ===========================================================
   Vercel Serverless Function — /api/lead
   Receives the lead from calculator.html, validates it
   server-side, blocks obvious bots, then forwards it to your
   Make / Zapier webhook (kept secret in WEBHOOK_URL env var).
   =========================================================== */

// Best-effort in-memory rate limit. Note: serverless instances are
// ephemeral and not shared, so this stops bursts from a single warm
// instance but is NOT a hard guarantee. For strict limits use an
// external store (Upstash Redis, Vercel KV).
const HITS = new Map(); // ip -> [timestamps]
const WINDOW_MS = 60_000; // 1 minute
const MAX_PER_WINDOW = 5;

function rateLimited(ip) {
  const now = Date.now();
  const recent = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  HITS.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const isPhone = (v) => /^[0-9\-\+\s]{9,15}$/.test(v);
const clean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
  const webhook = process.env.WEBHOOK_URL;
  if (!webhook) {
    console.error("WEBHOOK_URL env var is not set");
    return res.status(500).json({ ok: false, error: "Server not configured" });
  }

  // Vercel parses JSON bodies automatically; guard anyway.
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid JSON" });
    }
  }
  body = body || {};

  // --- Honeypot: real users never fill this hidden field ---
  if (clean(body.company)) {
    // Pretend success so bots don't learn they were caught.
    return res.status(200).json({ ok: true });
  }

  // --- Rate limit ---
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: "Too many requests" });
  }

  // --- Server-side validation (the real gate) ---
  const name = clean(body.name, 120);
  const phone = clean(body.phone, 30);
  const email = clean(body.email, 160);
  const consent = body.consent === true;

  const errors = [];
  if (name.length < 2) errors.push("name");
  if (!isPhone(phone)) errors.push("phone");
  if (!isEmail(email)) errors.push("email");
  if (!consent) errors.push("consent");
  if (errors.length) {
    return res.status(422).json({ ok: false, error: "Validation failed", fields: errors });
  }

  // --- Sanitize the project/estimate payload (never trust the client) ---
  const ALLOWED_PTYPE = ["full", "dry", "kitchen", "bath", "comm", "outdoor"];
  const ALLOWED_TIER = ["basic", "standard", "premium"];
  const ALLOWED_CATS = ["labor", "materials", "furniture", "design"];

  const ptype = ALLOWED_PTYPE.includes(body.ptype) ? body.ptype : "full";
  const tier = ALLOWED_TIER.includes(body.tier) ? body.tier : "standard";
  const area = Math.max(1, Math.min(2000, Number(body.area) || 0));
  const cats = {};
  for (const k of ALLOWED_CATS) cats[k] = !!(body.cats && body.cats[k]);
  const estimate = Math.max(0, Math.round(Number(body.estimate) || 0));

  const lead = {
    name,
    phone,
    email,
    consent,
    project: { ptype, tier, area, cats },
    estimate,
    meta: {
      ip,
      userAgent: clean(req.headers["user-agent"], 300),
      referer: clean(req.headers["referer"], 300),
      receivedAt: new Date().toISOString(),
    },
  };

  // --- Forward to Make / Zapier ---
  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    });
    if (!r.ok) {
      console.error("Webhook responded", r.status, await r.text().catch(() => ""));
      return res.status(502).json({ ok: false, error: "Upstream webhook failed" });
    }
  } catch (err) {
    console.error("Webhook request error", err);
    return res.status(502).json({ ok: false, error: "Could not reach webhook" });
  }

  return res.status(200).json({ ok: true });
  } catch (err) {
    // TEMP DEBUG: surface the real error so we can diagnose the 500.
    console.error("Unhandled error in /api/lead", err);
    return res
      .status(500)
      .json({ ok: false, error: "Internal error", debug: String(err && err.stack || err) });
  }
}
