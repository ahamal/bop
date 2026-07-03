# bop push reminders — setup, testing, deployment

One-shot "remind me later" push notifications that arrive even with the site
closed. Three pieces, all in this repo:

| Piece | Where | What it does |
|---|---|---|
| Client helper | `src/notify/reminders.ts` | `scheduleReminder(delayMs)` — permission → subscribe → POST |
| Service worker | `public/sw.js` | Receives the push, shows the notification |
| Server | `server/` (this folder) | Cloudflare Worker: `POST /remind` stores to KV; a 5-min cron sweep Web-Pushes due reminders and deletes them |

Flow: button tap → `scheduleReminder()` subscribes the browser to push and
POSTs `{ subscription, dueAt }` to the Worker → Worker stores it in KV → cron
sweep finds it due → sends an encrypted push to the browser vendor's push
service → the browser (even with bop closed) wakes `sw.js` → notification.

No accounts, no persistent user data: a reminder is one KV row that deletes
itself after delivery (with a TTL as garbage-collection backstop).

---

## One-time setup

### 1. Generate VAPID keys

Web Push requires a keypair proving pushes come from you:

```sh
npx web-push generate-vapid-keys
```

Paste the **public key** into BOTH:
- `server/wrangler.toml` → `VAPID_PUBLIC_KEY`
- `src/notify/reminders.ts` → `VAPID_PUBLIC_KEY`

The **private key** never goes in a file that's committed (see steps 3/4).
Keep a copy somewhere safe (password manager): if you lose it, existing
subscriptions become unusable and users must re-subscribe.

### 2. Create the KV namespace

```sh
cd server
npm install
npx wrangler kv namespace create REMINDERS
```

Paste the printed `id` into `wrangler.toml` under `[[kv_namespaces]]`.
(First `wrangler` use opens a browser to log in to your Cloudflare account.)

### 3. Private key for local dev

Create `server/.dev.vars` (gitignored):

```
VAPID_PRIVATE_KEY=<the private key>
```

### 4. Private key for production

```sh
npx wrangler secret put VAPID_PRIVATE_KEY
```

(paste the key when prompted — stored encrypted in Cloudflare, never in git)

---

## Local testing

Two terminals:

```sh
# terminal 1 — the app
npm run dev              # http://localhost:5173

# terminal 2 — the worker (KV is emulated locally, nothing hits your account)
cd server && npm run dev # http://localhost:8787, scheduled handler enabled
```

`localhost` is a secure context, so service workers + push permission work in
plain `vite dev`. Subscriptions created on localhost are REAL — they point at
Google/Mozilla's actual push service, so delivery genuinely works end-to-end.

**Full end-to-end test (Chrome recommended):**

1. In the app, call `scheduleReminder(60_000)` from a button tap (or the
   DevTools console *after* a click somewhere — the permission prompt needs a
   user gesture). Accept the permission prompt.
2. Confirm the Worker stored it: terminal 2 logs the POST.
3. Fire the cron sweep manually instead of waiting:
   ```sh
   cd server && npm run trigger
   # (curls http://localhost:8787/__scheduled — only exists under --test-scheduled)
   ```
   If the reminder isn't due yet, the sweep skips it — schedule with a short
   delay (e.g. `scheduleReminder(5_000)`) and trigger again.
4. **Close the bop tab first**, then trigger — the notification must still
   arrive (the push service wakes the service worker; only Chrome itself needs
   to be running). This is the part that proves the whole design.

**Smaller test loops:**

- *Service worker only, no server:* DevTools → Application → Service Workers →
  "Push" button injects a fake push event; `sw.js` should show its default
  notification.
- *Reset state while iterating:* DevTools → Application → Service Workers →
  Unregister, and the 🔒/⚙ icon in the address bar → reset notification
  permission. Stale service workers are the #1 source of confusion — when in
  doubt, "Update on reload" checkbox.
- *Inspect local KV:* the emulated store lives under `server/.wrangler/`; or
  just log in the Worker.

**Safari/iOS:** don't test locally. Push a branch, use the `*.pages.dev`
preview URL (HTTPS). iOS additionally requires the app added to the home
screen before push works at all.

---

## Deployment

The static site keeps deploying via git push (Cloudflare Pages). The Worker
deploys separately, by hand — it changes rarely:

```sh
cd server
npm run deploy
```

First deploy, then wire up the domain and check config:

1. **Custom domain**: declared in `wrangler.toml` (`bop-api.ashween.com`, the
   `routes` line), so the deploy attaches it automatically. The client's
   production `API_BASE` in `src/notify/reminders.ts` points there.
2. **Verify the cron** is registered: Worker → Settings → Triggers → Cron
   Triggers should show `*/5 * * * *`.
3. **Verify the secret**: Worker → Settings → Variables — `VAPID_PRIVATE_KEY`
   should be listed (from `wrangler secret put`).
4. **Production smoke test**: open `https://bop.ashween.com`, schedule a
   1-minute reminder, close the tab, wait for the next 5-minute sweep. Live
   tail while you wait: `npx wrangler tail` from `server/`.

Redeploying later is just `npm run deploy` again. `wrangler.toml` is the
source of truth for config — dashboard edits get overwritten on deploy.

### Costs

Free tier covers: Worker requests (100k/day), cron invocations, KV reads
(100k/day). The binding limit is **KV writes: 1,000/day free** — one write per
scheduled reminder. Past that, Workers Paid is $5/mo. Push delivery itself is
free (Google/Mozilla/Apple charge nothing).

---

## Wiring the UI (still to do)

`scheduleReminder()` is ready but nothing calls it yet. When adding buttons
("Remind me in 2 hours", "Tomorrow at 9:00"):

- Call it directly in the click handler — the permission prompt requires a
  user gesture, and Safari is strict about this.
- Check `remindersSupported()` first and hide the buttons if false.
- "Tomorrow at hh:mm" → compute the absolute time client-side and pass the
  delta: `scheduleReminder(target.getTime() - Date.now())`. Timezones stay a
  client-only concern; the server just gets a UTC timestamp.
- It resolves `false` on denial/failure — show a quiet "couldn't set reminder"
  rather than nothing.

## Gotchas & troubleshooting

- **Notification arrives with the tab open too** — that's correct; the service
  worker handles it either way. (If showing in-page UI instead someday, same
  `tag` keeps them from stacking.)
- **`buildPushPayload` errors about keys** → public/private key mismatch
  between `wrangler.toml`, `.dev.vars`/secret, and `reminders.ts` — all three
  must come from the same `generate-vapid-keys` run.
- **Push arrives locally but not in production** → almost always CORS or
  domain: check `ALLOWED_ORIGINS` in `server/src/index.ts` matches the site
  origin exactly, and that `bop-api.ashween.com` is attached to the Worker.
- **410 Gone from the push endpoint** → the user cleared site data or revoked
  permission; the sweep deletes these automatically.
- **Nothing at all on iPhone** → not installed to home screen (iOS 16.4+
  requirement), or iOS Low Power Mode deferring delivery.
- **Reminder up to ~5 min late** → by design (cron granularity). Tighten the
  cron in `wrangler.toml` if it matters; still free.
