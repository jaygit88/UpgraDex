// The collection lives in this browser (localStorage) and, optionally, is synced to Firebase.
//
// entries[dex] = {
//   owned: Slot | null,      // the card he has now (null = missing)
//   ups: Slot[],             // up to 3 ranked upgrades
//   note: string,
//   u: number                // last-changed timestamp, used to merge between devices
// }
// Slot = { id, name, img, rarity, set, setId, num, date, lang: 'EN'|'JP'|'KR', custom?, unknown? }

import { useEffect, useState } from '../vendor/preact-htm.js';

const KEY = 'pu:collection';
const SETTINGS_KEY = 'pu:settings';
export const MAX_UPS = 3;
export const LANGS = ['EN', 'JP', 'KR'];

let entries = {};
let version = 0;
const listeners = new Set();
let syncPush = null; // set by sync.js

try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (raw && raw.entries) entries = raw.entries;
} catch {}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, entries }));
  } catch (e) {
    console.error('Could not save', e);
  }
}

function notify() {
  version++;
  for (const l of listeners) l(version);
}

export const EMPTY = Object.freeze({ owned: null, ups: [], note: '', u: 0 });

export function getEntry(dex) {
  return entries[dex] || EMPTY;
}

export function allEntries() {
  return entries;
}

function clean(e) {
  return JSON.parse(JSON.stringify(e));
}

export function setEntry(dex, next, { fromRemote = false } = {}) {
  const e = clean({ owned: next.owned || null, ups: (next.ups || []).slice(0, MAX_UPS), note: next.note || '', u: fromRemote ? next.u : Date.now() });
  entries = { ...entries, [dex]: e };
  persist();
  notify();
  if (!fromRemote && syncPush) syncPush(String(dex), e);
  return e;
}

export function updateEntry(dex, fn) {
  const cur = clean(getEntry(dex));
  const next = fn(cur) || cur;
  return setEntry(dex, next);
}

// Apply a change that came from another device: newest wins.
export function mergeRemote(dex, remote) {
  const local = entries[dex];
  if (local && (local.u || 0) >= (remote.u || 0)) return false;
  setEntry(dex, remote, { fromRemote: true });
  return true;
}

export function replaceAll(newEntries) {
  const now = Date.now();
  entries = {};
  for (const [dex, e] of Object.entries(newEntries || {})) {
    entries[dex] = clean({ owned: e.owned || null, ups: e.ups || [], note: e.note || '', u: now });
  }
  persist();
  notify();
  if (syncPush) for (const [dex, e] of Object.entries(entries)) syncPush(dex, e);
}

export function setSyncPush(fn) {
  syncPush = fn;
}

export function useCollection() {
  const [, setV] = useState(version);
  useEffect(() => {
    const l = (v) => setV(v);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return entries;
}

// ---------- Slots ----------

export function slotFromCard(card, lang = 'EN') {
  return {
    id: card.id, name: card.name, img: card.img || '', rarity: card.rarity || '',
    set: card.set || '', setId: card.setId || '', num: card.num || '', date: card.date || '', lang,
  };
}

export function sameCard(a, b) {
  return !!(a && b && a.id && b.id && a.id === b.id);
}

// ---------- Settings (per device, not synced) ----------

function defaultSettings() {
  const loc = (navigator.language || 'en-GB').toUpperCase();
  const region = loc.split('-')[1] || '';
  const currency = { GB: 'GBP', US: 'USD', AU: 'AUD', CA: 'CAD', NZ: 'NZD', IE: 'EUR' }[region] || 'native';
  const priceSource = ['US', 'CA'].includes(region) ? 'tcgplayer' : 'cardmarket';
  return { priceSource, currency, fastSetup: false, defaultLang: 'EN', sync: null };
}

let settings = defaultSettings();
try {
  settings = { ...settings, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) };
} catch {}
const settingsListeners = new Set();

export function getSettings() {
  return settings;
}

export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  for (const l of settingsListeners) l(settings);
}

export function useSettings() {
  const [s, setS] = useState(settings);
  useEffect(() => {
    settingsListeners.add(setS);
    return () => settingsListeners.delete(setS);
  }, []);
  return s;
}

// ---------- Backup ----------

export function exportJSON() {
  return JSON.stringify({ app: 'pokeapp', v: 1, exported: new Date().toISOString(), entries }, null, 1);
}

export function parseImport(text) {
  const j = JSON.parse(text);
  if (!j || typeof j.entries !== 'object') throw new Error('That file is not a Dex Upgrades backup.');
  return j.entries;
}

// "12, 45, 130-132" -> Set{12,45,130,131,132}
export function parseNumberList(text) {
  const out = new Set();
  for (const part of String(text).split(/[\s,;]+/)) {
    if (!part) continue;
    const m = part.match(/^#?(\d+)(?:-#?(\d+))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i - a < 2000; i++) out.add(i);
  }
  return out;
}
