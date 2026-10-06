/* Installability needs a service worker with a fetch handler; this one
   deliberately caches nothing. Daisey's data already works offline through
   Firestore's own cache, and a stale app shell is the failure this repo has
   been bitten by before (see daisey/CLAUDE.md on serving old builds). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // pass through to the network

/* Notifications (functions/daisey-now-morning.js, 2026-10-06): show it,
   and a tap opens Daisey at its url ("./?open=wrap" opens the evening wrap).
   An open Daisey is brought forward and told what to open instead. */
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (_) { m = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || "Daisey", {
    body: m.body || "",
    tag: m.tag || "daisey",
    icon: "icons/daisey-192.png",
    badge: "icons/daisey-192.png",
    data: { url: m.url || "./" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope);
  const what = url.searchParams.get("open");
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (!open) return self.clients.openWindow(url.href);
    if (what) open.postMessage({ daisey: "open", what });
    return open.focus();
  }));
});
