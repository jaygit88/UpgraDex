// The app used to run from this folder. It now lives in app/ with its own service worker,
// so this one clears the old offline copy and removes itself.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('prod-')) await caches.delete(k);
    await self.registration.unregister();
  })());
});
