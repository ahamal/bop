// Client half of push reminders: permission → service worker → push
// subscription → POST to the reminder server (server/). Everything is lazy —
// nothing happens until the first scheduleReminder() call, and that call must
// come from a user gesture (a button tap): browsers require one for the
// permission prompt.

const API_BASE = import.meta.env.DEV
  ? "http://localhost:8787" // `npm run dev` in server/
  : "https://bop-api.ashween.com";

// The server's VAPID *public* key — safe to ship in the client. Paste the
// value from `npx web-push generate-vapid-keys` (see server/README.md).
const VAPID_PUBLIC_KEY =
  "BNFq4yyruc-KkF2qGr51bc4WRK-1dwwetPquDoWAOxLPGG9ZO1d7myairkfxdA3WODZ_F3KeGpPc0B5VuaM2eXI";

export function remindersSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * Schedule a one-shot push notification `delayMs` from now ("remind me in 2
 * hours" → scheduleReminder(2 * 60 * 60 * 1000)). Resolves false if
 * unsupported, permission was denied, or the server rejected the request.
 */
export async function scheduleReminder(
  delayMs: number,
  opts?: { title?: string; body?: string },
): Promise<boolean> {
  if (!remindersSupported() || VAPID_PUBLIC_KEY.startsWith("REPLACE")) return false;
  try {
    if ((await Notification.requestPermission()) !== "granted") return false;
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));
    const res = await fetch(`${API_BASE}/remind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        dueAt: Date.now() + delayMs,
        ...opts,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("bop reminder failed:", err);
    return false;
  }
}

// Web Push wants the VAPID key as raw bytes; it's distributed base64url-encoded.
function urlBase64ToUint8Array(b64url: string): Uint8Array {
  const b64 = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
