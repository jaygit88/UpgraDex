// Price history: remembers each card's price day by day (whenever a fresh price comes in, plus a quiet
// refresh once a day for your cards, upgrades and swaps), and the total value of the collection.
// Kept on this device only (IndexedDB), not synced.

import { useEffect, useState } from '../vendor/preact-htm.js';
import { idbGet, idbSet } from './idb.js';
import { KEY_PREFIX } from './env.js';

const KEY = `${KEY_PREFIX}price-history:v1`;
const KEEP_DAYS = 400;
export const today = () => Math.floor(Date.now() / 864e5);
export const dayDate = (d) => new Date(d * 864e5);

// { cards: { priceKey: [[day, cardmarket, tcgplayer], …] }, totals: [[day, collection, swaps, upgrades, currency], …] }
let data = { cards: {}, totals: [] };
let loaded = null;
const listeners = new Set();
let saveTimer = null;

export function loadHistory() {
  if (!loaded) loaded = idbGet(KEY).then((d) => {
    if (d && d.cards) data = { cards: { ...d.cards, ...data.cards }, totals: d.totals || [] };
    notify();
  }).catch(() => {});
  return loaded;
}

function notify() { for (const f of listeners) f(); }

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { idbSet(KEY, data); notify(); }, 1500);
}

const round = (v) => (v == null ? null : Math.round(v * 100) / 100);

// The two headline prices we track (same picks as price.js headline()).
function points(p) {
  const cm = p?.cm && (p.cm.avg30 ?? p.cm.trend ?? p.cm.avg7 ?? p.cm.avg);
  const tp = p?.tp && p.tp.market;
  return [round(cm), round(tp)];
}

function upsert(list, row) {
  const last = list[list.length - 1];
  if (last && last[0] === row[0]) list[list.length - 1] = row;
  else list.push(row);
  const cutoff = today() - KEEP_DAYS;
  while (list.length && list[0][0] < cutoff) list.shift();
}

// Called by api.js whenever a fresh price arrives from the card database.
export async function recordPrice(key, p) {
  if (!key || !p) return;
  await loadHistory();
  const [cm, tp] = points(p);
  if (cm == null && tp == null) return;
  const list = data.cards[key] || (data.cards[key] = []);
  upsert(list, [today(), cm, tp]);
  save();
}

export async function recordTotals(collection, swaps, upgrades, currency) {
  await loadHistory();
  data.totals = data.totals.filter((t) => t[4] === currency); // a currency switch starts the chart again
  upsert(data.totals, [today(), round(collection), round(swaps), round(upgrades), currency]);
  save();
}

export function totalsHistory() { return data.totals; }

// How a card's price has moved over about `days` days.
// Uses the saved history when there's a price from long enough ago; otherwise Cardmarket's own
// "last 7 days vs last 30 days" averages give a quick idea of the recent direction.
export function cardChange(key, p, source = 'cardmarket', days = 30) {
  if (!key || !p) return null;
  const [cmNow, tpNow] = points(p);
  const useTp = source === 'tcgplayer' ? tpNow != null : cmNow == null;
  const now = useTp ? tpNow : cmNow;
  if (now == null) return null;
  const list = data.cards[key] || [];
  const target = today() - days;
  const minAge = Math.min(days, 7) * 0.7; // need at least ~5 days of history before trusting it
  let past = null;
  for (const row of list) {
    const v = useTp ? row[2] : row[1];
    if (v == null) continue;
    if (row[0] <= target) past = { v, day: row[0] };
    else { if (!past && today() - row[0] >= minAge) past = { v, day: row[0] }; break; }
  }
  if (past && past.v > 0) return { pct: ((now - past.v) / past.v) * 100, from: past.v, to: now, since: today() - past.day, kind: 'history' };
  if (!useTp && p.cm && p.cm.avg7 != null && p.cm.avg30 > 0) {
    return { pct: ((p.cm.avg7 - p.cm.avg30) / p.cm.avg30) * 100, from: p.cm.avg30, to: p.cm.avg7, kind: 'recent' };
  }
  return null;
}

export function useHistory() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    listeners.add(f);
    loadHistory();
    return () => listeners.delete(f);
  }, []);
  return data;
}

// ---------- Daily refresh ----------
// Once a day, a while after the app opens, refresh prices for the cards that matter and note the totals.
const LAST_KEY = `${KEY_PREFIX}price-history-last`;

export function startDailyRefresh({ store, api, valueOf, sumCurrency }) {
  const run = async () => {
    try {
      if (localStorage.getItem(LAST_KEY) === String(today())) return;
      if (navigator.onLine === false) return;
      const entries = store.allEntries();
      const owned = [], ups = [], swaps = [];
      for (const e of Object.values(entries)) {
        if (e.owned && !e.owned.unknown) owned.push(api.priceKey(e.owned));
        if (e.ups && e.ups[0]) ups.push(api.priceKey(e.ups[0]));
        for (const s of e.swaps || []) swaps.push([api.priceKey(s), s.qty]);
      }
      const all = [...owned, ...ups, ...swaps.map((s) => s[0])].filter(Boolean);
      if (!all.length) return;
      // Prices up to 20 hours old count as today's.
      const prices = new Map();
      await Promise.all([...new Set(all)].map(async (k) => {
        try { prices.set(k, await api.getPrices(k, { maxAge: 20 * 3600e3 })); } catch {}
      }));
      for (const [k, p] of prices) if (p && !p.stale) recordPrice(k, p);
      const settings = store.getSettings();
      const rates = await api.getRates();
      const val = (k) => valueOf(prices.get(k), settings, rates) || 0;
      const sum = (list) => list.filter(Boolean).reduce((n, k) => n + val(k), 0);
      await recordTotals(sum(owned), swaps.reduce((n, [k, q]) => n + (k ? val(k) * q : 0), 0), sum(ups), sumCurrency(settings));
      localStorage.setItem(LAST_KEY, String(today()));
    } catch {}
  };
  setTimeout(run, 15000);
}
