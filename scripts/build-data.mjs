// Regenerates data/pokedex.json and data/sets.json.
// Run with: node scripts/build-data.mjs
import { writeFile } from 'node:fs/promises';

async function getJSON(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
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

const GEN = { 'generation-i': 1, 'generation-ii': 2, 'generation-iii': 3, 'generation-iv': 4, 'generation-v': 5,
  'generation-vi': 6, 'generation-vii': 7, 'generation-viii': 8, 'generation-ix': 9 };

async function buildPokedex() {
  const list = await getJSON('https://pokeapi.co/api/v2/pokemon-species?limit=2000');
  const species = await pool(list.results, 16, async (s) => {
    const d = await getJSON(s.url);
    const en = d.names.find((n) => n.language.name === 'en');
    const ja = d.names.find((n) => n.language.name === 'ja-hrkt') || d.names.find((n) => n.language.name === 'ja');
    const ko = d.names.find((n) => n.language.name === 'ko');
    return [d.id, en ? en.name : d.name, GEN[d.generation.name] || 0, ja ? ja.name : '', ko ? ko.name : ''];
  });
  species.sort((a, b) => a[0] - b[0]);
  await writeFile('data/pokedex.json', JSON.stringify(species));
  console.log('pokedex', species.length);
}

async function buildSets() {
  const list = await getJSON('https://api.tcgdex.net/v2/en/sets');
  const sets = await pool(list, 8, async (s) => {
    const d = await getJSON(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(s.id)}`);
    return [d.id, { n: d.name, d: d.releaseDate || '', s: d.serie?.id || '', sn: d.serie?.name || '', a: d.abbreviation?.official || '', o: d.cardCount?.official || 0 }];
  });
  await writeFile('data/sets.json', JSON.stringify(Object.fromEntries(sets)));
  console.log('sets', sets.length);
}

await Promise.all([buildPokedex(), buildSets()]);
