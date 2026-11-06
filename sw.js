// Service worker: keeps the app working offline (e.g. in a shop with bad signal).
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const SPRITES = 'sprites-v1';
const SDK = 'sdk-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/api.js', 'js/data.js', 'js/idb.js', 'js/price.js', 'js/rarity.js', 'js/store.js', 'js/sync.js',
  'vendor/preact-htm.js', 'data/pokedex.json', 'data/sets.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL, SPRITES, SDK].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html')) || Response.error();
  }
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
  if (url.origin === location.origin) { e.respondWith(networkFirst(req)); return; }
  if (url.hostname === 'raw.githubusercontent.com' && url.pathname.includes('/sprites/')) {
    e.respondWith(cacheFirst(SPRITES, req, true));
    return;
  }
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(cacheFirst(SDK, req, false));
  }
  // Card pictures (assets.tcgdex.net) are cached by the browser for a year by themselves.
});
