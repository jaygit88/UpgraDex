// Service worker: keeps the app working offline (e.g. in a shop with bad signal).
// The real app and the test copy (under /test/) share one website, so each keeps its own caches.
const SCOPE = new URL(self.registration.scope);
const IS_TEST = /\/test\/$/.test(SCOPE.pathname);
const P = IS_TEST ? 'test-' : 'live-';
const VERSION = 'v23';
const SHELL = `${P}shell-${VERSION}`;
const SPRITES = `${P}sprites-v1`;
const SDK = `${P}sdk-v1`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/api.js', 'js/env.js', 'js/version.js', 'js/scan.js', 'js/config.js', 'js/verdict.js', 'js/trade.js', 'js/budget.js', 'js/summary.js', 'js/binder.js', 'js/swaps.js', 'js/history.js', 'js/share.js', 'js/changes.js', 'js/data.js', 'js/idb.js', 'js/price.js', 'js/rarity.js', 'js/store.js', 'js/sync.js',
  'vendor/preact-htm.js', 'data/pokedex.json', 'data/sets.json', 'data/extra-images.json',
  'icons/favicon-64.png', 'icons/header-gengar-art.png', 'icons/loading-charmander.gif', 'icons/loading-gastly.gif', 'icons/splash-falinks.webp', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      const mine = IS_TEST ? k.startsWith('test-') : k.startsWith('live-');
      if (mine && ![SHELL, SPRITES, SDK].includes(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

// Fresh files from the website when it's working; the saved copy when there's no signal, the
// website is slow (8s), or it answers with an error page (e.g. the host is down or the site moved).
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const saved = () => cache.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? cache.match('index.html') : null));
  const fresh = fetch(req).then(async (res) => {
    if (res.ok) { cache.put(req, res.clone()); return res; }
    return (await saved()) || res;
  }, async () => (await saved()) || Response.error());
  // Slow website: use the saved copy if there is one, otherwise keep waiting.
  const slow = new Promise((resolve) => setTimeout(async () => { const hit = await saved(); if (hit) resolve(hit); }, 8000));
  return Promise.race([fresh, slow]);
}

async function cacheFirst(cacheName, req, corsUrl) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(corsUrl ? new Request(req.url, { mode: 'cors' }) : req);
    if (res.ok) cache.put(req.url, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // The real app leaves the test copy's files to the test copy's own service worker.
    if (!IS_TEST && url.pathname.startsWith(SCOPE.pathname + 'test/')) return;
    e.respondWith(networkFirst(req));
    return;
  }
  if (url.hostname === 'raw.githubusercontent.com' && url.pathname.includes('/sprites/')) {
    e.respondWith(cacheFirst(SPRITES, req, true));
    return;
  }
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(cacheFirst(SDK, req, false));
  }
  // Card pictures (assets.tcgdex.net) are cached by the browser for a year by themselves.
});
