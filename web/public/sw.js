// Mugalim AI service worker. It only shows an offline page when a page cannot
// be loaded. Tests, answers and API responses are never cached: they always
// come from the server, so nobody can see an old test or lose a saved answer.
const CACHE = "mugalim-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Page loads only; every other request goes to the network untouched.
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () =>
    // The cached page can be evicted on a full phone; answer with plain text then.
    (await caches.match(OFFLINE_URL)) ||
    new Response("No internet connection / Нет связи с интернетом / Интернет байланысы жоқ", {
      status: 503, headers: { "content-type": "text/plain; charset=utf-8" },
    })));
});
