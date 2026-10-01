/* Service worker for the free reseller tools.
 *
 * These tools are single self-contained HTML files that do all their work in
 * the browser and upload nothing, so they can run offline exactly as well as
 * they run online. Caching them is not a performance trick here - it is the
 * difference between a page and an app you can open in a stockroom with no
 * signal, which is where a reseller actually is when they are writing titles.
 *
 * Strategy, and why:
 *   - navigations: network first, cache as fallback. The tools get corrected
 *     (fee tables change; eBay moved its dimensional divisor in July 2026), and
 *     serving a stale fee table from cache would be giving someone wrong
 *     numbers. Fresh when possible, offline when not.
 *   - everything else in scope: stale-while-revalidate.
 *   - cross-origin (the Google Fonts stylesheet): not handled. It is left to
 *     the browser, and every page declares a real fallback stack, so an offline
 *     load renders in the fallback rather than failing.
 *
 * Bump CACHE when the shipped files change, or the old set is never evicted.
 */
const CACHE = "reseller-toolkit-v1";
const SCOPE = "/title-budget/";

const PRECACHE = [
  SCOPE,
  SCOPE + "fees.html",
  SCOPE + "recursion-budget.html",
  SCOPE + "manifest.json",
  SCOPE + "icons/icon-192.png",
  SCOPE + "icons/icon-512.png",
  SCOPE + "icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll rejects the whole install if any single request fails, which
      // would leave the app with no offline copy at all. Each file is added
      // on its own so one 404 cannot take the rest down with it.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match(SCOPE))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
