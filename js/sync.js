// Optional cloud sync through a free Firebase (Firestore) project, so the tablet and phones
// all see the same collection. Each Pokémon is one document:
//   families/{familyCode}/entries/{dex}
// The family code is a long random string; anyone with the join link can see and edit.

import { allEntries, mergeRemote, setSyncPush, getSettings, updateSettings } from './store.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';

let status = { state: 'off', message: '' };
const statusListeners = new Set();
let unsubscribe = null;
let connectedKey = null;
let token = 0;

function setStatus(state, message = '') {
  status = { state, message };
  for (const l of statusListeners) l(status);
}

export function getSyncStatus() {
  return status;
}

export function onSyncStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function newFamilyCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// Accepts the snippet copied from the Firebase console (JS object or JSON).
export function parseFirebaseConfig(text) {
  const pick = (k) => {
    const m = String(text).match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`));
    return m ? m[1] : '';
  };
  const cfg = {
    apiKey: pick('apiKey'), authDomain: pick('authDomain'), projectId: pick('projectId'),
    appId: pick('appId'), storageBucket: pick('storageBucket'), messagingSenderId: pick('messagingSenderId'),
  };
  if (!cfg.apiKey || !cfg.projectId) throw new Error('Could not find apiKey and projectId in what you pasted.');
  for (const k of Object.keys(cfg)) if (!cfg[k]) delete cfg[k];
  return cfg;
}

function b64urlEncode(s) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(s)));
}

export function joinLink(sync) {
  const payload = b64urlEncode(JSON.stringify({ c: sync.config, k: sync.code }));
  return `${location.origin}${location.pathname}#join=${payload}`;
}

export function readJoinFromHash() {
  const m = location.hash.match(/#join=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const j = JSON.parse(b64urlDecode(m[1]));
    if (j && j.c && j.c.projectId && j.k) return { config: j.c, code: j.k };
  } catch {}
  return null;
}

export async function startSync() {
  const sync = getSettings().sync;
  if (!sync || !sync.enabled) { stopSync(); return; }
  const key = `${sync.config.projectId}/${sync.code}`;
  if (connectedKey === key) return;
  stopSync();
  connectedKey = key;
  const my = ++token;
  setStatus('connecting', 'Connecting…');
  try {
    const [{ initializeApp, getApps }, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    if (my !== token) return;
    const name = `pokeapp-${sync.config.projectId}`;
    const app = getApps().find((a) => a.name === name) || initializeApp(sync.config, name);
    const db = fs.getFirestore(app);
    const col = fs.collection(db, 'families', sync.code, 'entries');

    setSyncPush((dex, entry) => {
      fs.setDoc(fs.doc(col, dex), entry).catch((e) => setStatus('error', friendly(e)));
    });

    let first = true;
    unsubscribe = fs.onSnapshot(col, { includeMetadataChanges: false }, (snap) => {
      const remote = {};
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'removed') return;
        remote[ch.doc.id] = ch.doc.data();
        mergeRemote(ch.doc.id, ch.doc.data());
      });
      if (first) {
        first = false;
        // Push anything this device has that's newer than (or missing from) the cloud.
        const all = {};
        snap.docs.forEach((d) => { all[d.id] = d.data(); });
        for (const [dex, e] of Object.entries(allEntries())) {
          const r = all[dex];
          if (!r || (e.u || 0) > (r.u || 0)) fs.setDoc(fs.doc(col, dex), e).catch((err) => setStatus('error', friendly(err)));
        }
      }
      setStatus('on', snap.metadata.fromCache ? 'Offline – changes will sync later' : 'Synced');
    }, (err) => {
      if (my !== token) return;
      unsubscribe = null;
      connectedKey = null;
      setStatus('error', friendly(err));
    });
  } catch (e) {
    if (my !== token) return;
    connectedKey = null;
    setStatus('error', friendly(e));
  }
}

export function stopSync() {
  token++;
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  connectedKey = null;
  setSyncPush(null);
  setStatus('off', '');
}

export function restartSync() {
  stopSync();
  return startSync();
}

export function enableSync(config, code) {
  updateSettings({ sync: { config, code, enabled: true } });
  return startSync();
}

export function disableSync() {
  updateSettings({ sync: null });
  stopSync();
}

function friendly(e) {
  const msg = (e && (e.code || e.message)) || String(e);
  if (/permission/i.test(msg)) return 'Permission denied – check the Firestore rules (see setup guide).';
  if (/failed to fetch|network|import/i.test(msg)) return 'Could not reach Firebase – are you online?';
  return msg;
}
