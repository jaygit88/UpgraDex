// Builds the Japanese and Korean card indexes the app uses when a card's language is JP or KR.
//
// TCGdex's fast search only covers English cards, so this walks every Japanese/Korean set once and
// files each card under its Pokémon by recognising the Pokémon's Japanese/Korean name in the card name
// (e.g. "ブラッキーex" -> Umbreon). Writes:
//   data/sets-<lang>.json   setId -> { n: name, d: releaseDate, s: seriesId, o: official card count }
//   data/cards-<lang>.json  dex -> [[cardId, number, name, hasPicture(1/0)], ...]  (newest set first)
// Run with: node scripts/build-intl.mjs   (NODE_USE_ENV_PROXY=1 behind a proxy)
import { readFile, writeFile } from 'node:fs/promises';

async function getJSON(url, tries = 5) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 700 * 2 ** i));
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

const POCKET = /^(A\d|B\d|P-[AB])/; // Pokémon TCG Pocket (digital) sets
const fold = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '');

const pokedex = JSON.parse(await readFile('data/pokedex.json', 'utf8')); // [dex, en, gen, ja, ko]

async function build(lang, nameIndex) {
  // Longest names first, so "ミュウツー" (Mewtwo) wins over "ミュウ" (Mew).
  const names = pokedex
    .map((p) => ({ dex: p[0], name: fold(p[nameIndex]) }))
    .filter((p) => p.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);
  // Some older entries use English names ("Umbreon"): match those as whole words.
  const english = pokedex.map((p) => ({ dex: p[0], re: new RegExp(`(^|[^a-z])${p[1].toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`) }))
    .sort((a, b) => b.re.source.length - a.re.source.length);
  const findDex = (cardName) => names.find((p) => fold(cardName).includes(p.name))?.dex
    || english.find((p) => p.re.test(String(cardName).toLowerCase()))?.dex || 0;

  const list = await getJSON(`https://api.tcgdex.net/v2/${lang}/sets`);
  const sets = {};
  const byDex = {};
  let cardsSeen = 0, filed = 0, pictures = 0;
  const details = await pool(list.filter((s) => !POCKET.test(s.id)), 8, (s) => getJSON(`https://api.tcgdex.net/v2/${lang}/sets/${encodeURIComponent(s.id)}`).catch(() => null));
  for (const d of details) {
    if (!d) continue;
    sets[d.id] = { n: d.name, d: d.releaseDate || '', s: d.serie?.id || '', o: d.cardCount?.official || 0 };
    for (const c of d.cards || []) {
      cardsSeen++;
      const dex = findDex(c.name);
      if (!dex) continue; // trainers, energy, items
      filed++;
      if (c.image) pictures++;
      (byDex[dex] ||= []).push([c.id, c.localId, c.name, c.image ? 1 : 0, d.releaseDate || '']);
    }
  }
  // Newest first, then by number.
  for (const dex of Object.keys(byDex)) {
    byDex[dex].sort((a, b) => (b[4] || '').localeCompare(a[4] || '') || String(a[1]).localeCompare(String(b[1]), undefined, { numeric: true }));
    byDex[dex] = byDex[dex].map(([id, num, name, img]) => [id, num, name, img]);
  }
  await writeFile(`data/sets-${lang}.json`, JSON.stringify(sets));
  await writeFile(`data/cards-${lang}.json`, JSON.stringify(byDex));
  console.log(`${lang}: ${Object.keys(sets).length} sets, ${cardsSeen} cards, ${filed} Pokémon cards filed under ${Object.keys(byDex).length} Pokémon, ${pictures} with pictures`);
}

await build('ja', 3);
await build('ko', 4);
