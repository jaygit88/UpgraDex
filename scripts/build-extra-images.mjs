// Fills gaps in TCGdex's card pictures with pictures from pokemontcg.io.
// For every TCGdex card without an image, finds the same card (same set, same number) on
// pokemontcg.io and records its image path. Writes data/extra-images.json:
//   { "<tcgdex card id>": "<path on images.pokemontcg.io, without .png>" }
// The app then shows https://images.pokemontcg.io/<path>.png (or _hires.png) for those cards.
// Run with: node scripts/build-extra-images.mjs   (needs NODE_USE_ENV_PROXY=1 behind a proxy)
import { readFile, writeFile } from 'node:fs/promises';

async function getJSON(url, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 800 * 2 ** i));
    }
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// "SV001" -> "sv1", "GG01" -> "gg1", "085" -> "85"
const normNum = (s) => String(s || '').toLowerCase().replace(/\s/g, '').replace(/^([a-z]*)0+(\d)/, '$1$2');

const sets = JSON.parse(await readFile('data/sets.json', 'utf8'));
const ptcgSets = (await getJSON('https://api.pokemontcg.io/v2/sets?pageSize=250')).data;
const byName = new Map();
for (const s of ptcgSets) {
  for (const key of [norm(s.name), norm(`${s.series} ${s.name}`)]) if (!byName.has(key)) byName.set(key, s);
}

// Names that differ between the two databases.
const ALIASES = {
  pokemonfutsalcollection: 'pokemonfutsal2020',
  svpblackstarpromos: 'scarletvioletblackstarpromos',
  '30thclassiccollection': '30thcelebrationclassiccollection',
  scarletvioletenergy: 'scarletvioletenergies',
};

const tcgdexIds = Object.keys(sets).filter((id) => sets[id].s !== 'tcgp');
// Keep what earlier runs found (pokemontcg.io's API often fails), and add to it.
const result = JSON.parse(await readFile('data/extra-images.json', 'utf8').catch(() => '{}'));
let missingTotal = 0, matchedTotal = 0;
const unmatchedSets = [];

await pool(tcgdexIds, 6, async (id) => {
  const set = await getJSON(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(id)}`).catch(() => null);
  if (!set) return;
  const missing = (set.cards || []).filter((c) => !c.image && !result[c.id]);
  if (!missing.length) return;
  missingTotal += missing.length;
  const key = norm(set.name);
  const ps = byName.get(ALIASES[key] || key);
  if (!ps) { unmatchedSets.push(`${id} (${set.name}): ${missing.length}`); return; }
  const cards = [];
  for (let page = 1; page <= 5; page++) {
    const r = await getJSON(`https://api.pokemontcg.io/v2/cards?q=set.id:${ps.id}&select=id,name,number,images&pageSize=250&page=${page}`).catch(() => null);
    if (!r) break;
    cards.push(...r.data);
    if (r.data.length < 250) break;
  }
  const byNum = new Map(cards.map((c) => [normNum(c.number), c]));
  // Some sets are numbered differently ("CC002" here, "2" there): also index by the digits alone.
  const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^0+(\d)/, '$1');
  const byDigits = new Map();
  for (const c of cards) if (!byDigits.has(digits(c.number))) byDigits.set(digits(c.number), c);
  // Last resort (sets numbered in a completely different way): a name that appears only once in the set.
  const nameCount = new Map();
  for (const c of cards) nameCount.set(norm(c.name), (nameCount.get(norm(c.name)) || 0) + 1);
  const uniqueByName = new Map(cards.filter((c) => nameCount.get(norm(c.name)) === 1).map((c) => [norm(c.name), c]));
  let matched = 0;
  for (const c of missing) {
    let p = byNum.get(normNum(c.localId)) || byDigits.get(digits(c.localId));
    const sameName = (x) => x && (norm(x.name) === norm(c.name) || norm(x.name).startsWith(norm(c.name).slice(0, 5)));
    if (!sameName(p)) p = uniqueByName.get(norm(c.name));
    if (sameName(p)) {
      // Use the picture address pokemontcg.io gives (it doesn't always follow set/number).
      const small = p.images && p.images.small;
      const m = small && small.match(/^https:\/\/images\.pokemontcg\.io\/(.+)\.png$/);
      result[c.id] = m ? m[1] : `${ps.id}/${p.number}`;
      matched++;
    }
  }
  matchedTotal += matched;
  if (matched < missing.length) unmatchedSets.push(`${id} (${set.name}): ${missing.length - matched} of ${missing.length} not matched`);
});

// pokemontcg.io lists some pictures it doesn't actually have: keep only ones that load.
const checks = await pool(Object.entries(result), 12, async ([id, path]) => {
  try {
    const r = await fetch(`https://images.pokemontcg.io/${path}.png`, { headers: { 'User-Agent': 'Mozilla/5.0 (UpgraDex data build)' } });
    return [id, r.ok && (r.headers.get('content-type') || '').startsWith('image')];
  } catch { return [id, true]; } // network blip: keep it, the app falls back to a placeholder anyway
});
for (const [id, ok] of checks) if (!ok) delete result[id];

const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
await writeFile('data/extra-images.json', JSON.stringify(sorted));
console.log(`Newly found on pokemontcg.io this run: ${matchedTotal} of ${missingTotal} still missing; total with a fallback picture: ${Object.keys(sorted).length}`);
if (unmatchedSets.length) console.log('Still without pictures:\n  ' + unmatchedSets.sort().join('\n  '));
