/* Installability needs a service worker with a fetch handler; this one
   deliberately caches nothing. Daisey's data already works offline through
   Firestore's own cache, and a stale app shell is the failure this repo has
   been bitten by before (see daisey/CLAUDE.md on serving old builds). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // pass through to the network
