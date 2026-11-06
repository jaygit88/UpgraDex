// Card data and prices from TCGdex (https://tcgdex.dev) — free, no API key needed.

import { SETS } from './data.js';
import { idbGet, idbSet } from './idb.js';

const BASE = 'https://api.tcgdex.net/v2';
const CARDS_TTL = 3 * 24 * 3600e3; // card lists: refresh every 3 days
const PRICE_TTL = 12 * 3600e3; // prices: refresh every 12 hours
const POCKET_ID = /^(A\d|B\d|P-[AB])/; // Pokémon TCG Pocket (digital-only) sets

async function gql(query) {
  const r = await fetch(`${BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`Card database error (${r.status})`);
  const j = await r.json();
  if (!j.data) throw new Error(j.errors?.[0]?.message || 'Card database error');
  return j.data;
}

const FIELDS = 'id name rarity image localId category dexId set { id name }';

async function pagedCards(filter, maxPages) {
  let all = [];
  for (let page = 1; page <= maxPages; page++) {
    const d = await gql(`{ c: cards(filters:{${filter}}, pagination:{page:${page},count:100}) { ${FIELDS} } }`);
    all = all.concat(d.c || []);
    if (!d.c || d.c.length < 100) break;
  }
  return all;
}

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’`]/g, "'").replace(/[♀♂]/g, '').trim();
}

function nameMatches(cardName, species) {
  const n = norm(species).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${n}($|[^a-z0-9])`).test(norm(cardName));
}

function isPocket(setId) {
  return SETS[setId]?.s === 'tcgp' || POCKET_ID.test(setId);
}

function toCard(c) {
  const setId = c.set?.id || c.id.replace(/-[^-]+$/, '');
  const s = SETS[setId];
  return {
    id: c.id,
    name: c.name,
    rarity: c.rarity || '',
    img: c.image || '',
    num: c.localId || '',
    setId,
    set: c.set?.name || s?.n || setId,
    date: s?.d || '9999-12-31', // unknown set = probably brand new
  };
}

// All physical (non-Pocket) cards for a Pokédex number, newest first.
async function fetchCardsFor(dex, speciesName) {
  const searchName = speciesName.replace(/[♀♂]/g, '').trim();
  const [byDex, byName] = await Promise.all([
    pagedCards(`dexId:${dex}`, 10),
    // Some brand-new cards don't have a Pokédex number yet, so also search by name.
    pagedCards(`name:${JSON.stringify(searchName)}`, 5).catch(() => []),
  ]);
  const seen = new Map();
  for (const c of byDex) seen.set(c.id, c);
  for (const c of byName) {
    if (seen.has(c.id)) continue;
    if (c.dexId && c.dexId.length) continue; // belongs to another Pokémon
    if (c.category && c.category !== 'Pokemon') continue;
    if (nameMatches(c.name, speciesName)) seen.set(c.id, c);
  }
  const cards = [...seen.values()].map(toCard).filter((c) => !isPocket(c.setId));
  cards.sort((a, b) => b.date.localeCompare(a.date) || a.num.localeCompare(b.num, undefined, { numeric: true }));
  return cards;
}

const inflight = new Map();

// Returns { cards, stale, error }. Uses a cached copy when offline.
export async function getCardsFor(dex, speciesName, { force = false } = {}) {
  const key = `cards:v1:${dex}`;
  const cached = await idbGet(key);
  if (cached && !force && Date.now() - cached.t < CARDS_TTL) return { cards: cached.cards };
  if (!inflight.has(key)) {
    inflight.set(key, fetchCardsFor(dex, speciesName).finally(() => inflight.delete(key)));
  }
  try {
    const cards = await inflight.get(key);
    await idbSet(key, { t: Date.now(), cards });
    return { cards };
  } catch (e) {
    if (cached) return { cards: cached.cards, stale: true };
    return { cards: [], error: e.message || 'Could not load cards' };
  }
}

// ---------- Prices ----------

const priceMemory = new Map();
const queue = [];
let running = 0;

function pump() {
  while (running < 4 && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });
}

const good = (v) => (typeof v === 'number' && v > 0 ? v : null);

export function extractPrices(card) {
  const p = card.pricing || {};
  const out = { updated: null, cm: null, tp: null };
  const cm = p.cardmarket;
  if (cm) {
    out.cm = {
      unit: cm.unit || 'EUR',
      avg30: good(cm.avg30), avg7: good(cm.avg7), trend: good(cm.trend), low: good(cm.low), avg: good(cm.avg),
      rev30: good(cm['avg30-holo']) || good(cm['trend-holo']),
      productId: cm.idProduct || null,
    };
    out.updated = cm.updated || null;
  }
  const tp = p.tcgplayer;
  if (tp) {
    const variants = Object.entries(tp).filter(([k, v]) => v && typeof v === 'object');
    const pick = (name) => variants.find(([k]) => k === name)?.[1];
    const mainEntry = variants.find(([k]) => k === 'holofoil') || variants.find(([k]) => k === 'normal')
      || variants.find(([k]) => !k.includes('reverse'));
    const main = mainEntry?.[1];
    const rev = pick('reverse-holofoil') || pick('reverse');
    if (main || rev) {
      out.tp = {
        unit: tp.unit || 'USD',
        variant: mainEntry?.[0] || '',
        market: good(main?.marketPrice) || good(main?.midPrice),
        low: good(main?.lowPrice),
        rev: good(rev?.marketPrice) || good(rev?.midPrice),
        productId: main?.productId || rev?.productId || null,
      };
    }
    out.updated = out.updated || tp.updated || null;
  }
  return out;
}

export function peekPrices(id) {
  return priceMemory.get(id);
}

export async function getPrices(id) {
  if (!id) return null;
  const mem = priceMemory.get(id);
  if (mem && Date.now() - mem.t < PRICE_TTL) return mem;
  const key = `price:v1:${id}`;
  const cached = await idbGet(key);
  if (cached && Date.now() - cached.t < PRICE_TTL) { priceMemory.set(id, cached); return cached; }
  try {
    const value = await enqueue(async () => {
      const r = await fetch(`${BASE}/en/cards/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`Price lookup failed (${r.status})`);
      const card = await r.json();
      return { t: Date.now(), ...extractPrices(card) };
    });
    priceMemory.set(id, value);
    idbSet(key, value);
    return value;
  } catch (e) {
    if (cached) { const v = { ...cached, stale: true }; priceMemory.set(id, v); return v; }
    throw e;
  }
}

// ---------- Currency conversion (optional) ----------

// Used only if the rate service can't be reached and nothing is saved yet (rates from Nov 2026).
const FALLBACK_RATES = { EUR: 1, GBP: 0.834, USD: 1.122, AUD: 1.72, CAD: 1.57, NZD: 1.95 };

let ratesPromise = null;
export function getRates() {
  if (ratesPromise) return ratesPromise;
  ratesPromise = (async () => {
    try {
      const c = JSON.parse(localStorage.getItem('pu:rates') || 'null');
      if (c && Date.now() - c.t < 24 * 3600e3) return c.rates;
    } catch {}
    try {
      const r = await fetch('https://api.frankfurter.dev/v1/latest?from=EUR&to=USD,GBP,AUD,CAD,NZD');
      if (!r.ok) throw new Error('rates');
      const j = await r.json();
      const rates = { EUR: 1, ...j.rates };
      try { localStorage.setItem('pu:rates', JSON.stringify({ t: Date.now(), rates })); } catch {}
      return rates;
    } catch {
      try { const c = JSON.parse(localStorage.getItem('pu:rates') || 'null'); if (c?.rates) return c.rates; } catch {}
      return FALLBACK_RATES;
    }
  })();
  return ratesPromise;
}
