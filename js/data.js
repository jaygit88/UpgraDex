// Static data shipped with the app: the Pokédex list and the set list (with release dates).
// Regenerate with `node scripts/build-data.mjs`.

export let POKEDEX = []; // [{ dex, name, gen, ja, ko }]
export let SETS = {}; // id -> { n: name, d: releaseDate, s: seriesId, sn: seriesName, a: abbreviation }
export const BY_DEX = new Map();

export async function loadStaticData() {
  const [dex, sets] = await Promise.all([
    fetch('data/pokedex.json').then((r) => r.json()),
    fetch('data/sets.json').then((r) => r.json()),
  ]);
  POKEDEX = dex.map(([n, name, gen, ja, ko]) => ({ dex: n, name, gen, ja, ko }));
  for (const p of POKEDEX) BY_DEX.set(p.dex, p);
  SETS = sets;
}

export const TOTAL = () => POKEDEX.length;

export function pad(n) {
  return '#' + String(n).padStart(4, '0');
}

export function spriteUrl(dex) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;
}

export function cardImg(img, quality = 'low') {
  return img ? `${img}/${quality}.webp` : null;
}

export const GENS = [
  [1, 'Kanto'], [2, 'Johto'], [3, 'Hoenn'], [4, 'Sinnoh'], [5, 'Unova'],
  [6, 'Kalos'], [7, 'Alola'], [8, 'Galar'], [9, 'Paldea'],
];
