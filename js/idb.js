// Tiny IndexedDB key-value store used for caching card lists and prices.
// Falls back to an in-memory map if IndexedDB is unavailable.

let dbPromise = null;
const memory = new Map();

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open('pokeapp-cache', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function idbGet(key) {
  const db = await open();
  if (!db) return memory.get(key);
  return new Promise((resolve) => {
    try {
      const req = db.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function idbSet(key, value) {
  const db = await open();
  if (!db) { memory.set(key, value); return; }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbClear() {
  memory.clear();
  const db = await open();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
