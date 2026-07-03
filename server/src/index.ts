// bop reminder server — a single Cloudflare Worker with two halves:
//
//   fetch     → POST /remind  { subscription, dueAt, title?, body? }
//               Stores a one-shot reminder in KV under a key that sorts by due
//               time, so the sweep can walk from the front and stop early.
//   scheduled → cron sweep (every 5 min): Web-Push every due reminder to the
//               browser's push endpoint, then delete it. Nothing persists
//               after delivery — no accounts, no subscription database.

import { buildPushPayload } from "@block65/webcrypto-web-push";

interface Env {
  REMINDERS: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string; // secret — wrangler secret / .dev.vars
  VAPID_SUBJECT: string;
}

interface StoredReminder {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  dueAt: number;
  title: string;
  body: string;
}

// Browsers the app is served from; anything else gets no CORS grant.
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173", // vite dev
  "https://bop.ashween.com",
]);

const MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000; // refuse reminders > 30 days out
const STALE_MS = 24 * 60 * 60 * 1000; // give up on undeliverable reminders after a day

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(status: number, data: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (req.method !== "POST" || new URL(req.url).pathname !== "/remind") {
      return json(404, { error: "not found" }, origin);
    }

    let body: {
      subscription?: StoredReminder["subscription"];
      dueAt?: number;
      title?: string;
      body?: string;
    };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid JSON" }, origin);
    }

    const sub = body.subscription;
    const dueAt = body.dueAt;
    if (
      typeof dueAt !== "number" ||
      !Number.isFinite(dueAt) ||
      !sub?.endpoint?.startsWith("https://") ||
      !sub.keys?.p256dh ||
      !sub.keys?.auth
    ) {
      return json(400, { error: "expected { subscription, dueAt }" }, origin);
    }
    if (dueAt > Date.now() + MAX_AHEAD_MS) {
      return json(400, { error: "dueAt too far ahead" }, origin);
    }

    const stored: StoredReminder = {
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      dueAt,
      title: body.title ?? "bop",
      body: body.body ?? "Time for your neck routine.",
    };
    // Zero-padded due time makes keys sort chronologically.
    const key = `due:${String(Math.max(0, Math.floor(dueAt))).padStart(14, "0")}:${crypto.randomUUID()}`;
    // expirationTtl is a safety net: KV garbage-collects anything the sweep
    // somehow never sent.
    const ttl = Math.max(60, Math.ceil((dueAt - Date.now() + STALE_MS) / 1000));
    await env.REMINDERS.put(key, JSON.stringify(stored), { expirationTtl: ttl });
    return json(201, { ok: true }, origin);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    const vapid = {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    };

    // Keys sort by due time: walk from the front, stop at the first future one.
    const list = await env.REMINDERS.list({ prefix: "due:" });
    for (const { name } of list.keys) {
      const dueAt = Number(name.slice(4, 18));
      if (dueAt > now) break;

      const raw = await env.REMINDERS.get(name);
      if (!raw) continue; // expired or raced away
      const r: StoredReminder = JSON.parse(raw);
      try {
        const payload = await buildPushPayload(
          {
            data: JSON.stringify({ title: r.title, body: r.body }),
            options: { ttl: 3600, urgency: "high" },
          },
          { ...r.subscription, expirationTime: null },
          vapid,
        );
        const res = await fetch(r.subscription.endpoint, payload);
        // 2xx = delivered; 404/410 = the subscription is gone. Both are final.
        // Anything else (5xx, 429) is retried on later sweeps until stale.
        if (res.ok || res.status === 404 || res.status === 410 || dueAt < now - STALE_MS) {
          await env.REMINDERS.delete(name);
        }
      } catch {
        if (dueAt < now - STALE_MS) await env.REMINDERS.delete(name);
      }
    }
  },
};
