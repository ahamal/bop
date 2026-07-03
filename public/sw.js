// Service worker: receives push messages (sent by server/ via Web Push) and
// shows them as notifications. This file must live at the site root so its
// scope covers the whole app.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    // Non-JSON payload (e.g. DevTools' "Push" test button) — use defaults.
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "bop", {
      body: data.body || "Time for your neck routine.",
      // One tag = later notifications replace earlier ones instead of stacking.
      tag: "bop-reminder",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Focus an open bop tab if there is one; otherwise open the app.
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) if ("focus" in tab) return tab.focus();
      return clients.openWindow("/");
    }),
  );
});
