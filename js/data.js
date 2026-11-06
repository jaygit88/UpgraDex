// Static data shipped with the app: the Pokédex list and the set list (with release dates).
// Regenerate with `node scripts/build-data.mjs`.

export let POKEDEX = []; // [{ dex, name, gen, ja, ko }]
export let SETS = {}; // id -> { n: name, d: releaseDate, s: seriesId, sn: seriesName, a: abbreviation }
export const BY_DEX = new Map();
export let EXTRA_IMAGES = {}; // TCGdex card id -> picture path on images.pokemontcg.io (for cards TCGdex has no picture of)

export async function loadStaticData() {
  const [dex, sets, extra] = await Promise.all([
    fetch('data/pokedex.json').then((r) => r.json()),
    fetch('data/sets.json').then((r) => r.json()),
    fetch('data/extra-images.json').then((r) => r.json()).catch(() => ({})),
  ]);
  EXTRA_IMAGES = extra;
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

// The picture for a card: TCGdex's own, or a pokemontcg.io one where TCGdex has none.
export function cardPicture(card, quality = 'low') {
  if (!card || card.custom) return null;
  if (card.img) return cardImg(card.img, quality);
  const extra = card.id && EXTRA_IMAGES[card.id];
  return extra ? `https://images.pokemontcg.io/${extra}${quality === 'high' ? '_hires' : ''}.png` : null;
}

export const GENS = [
  [1, 'Kanto'], [2, 'Johto'], [3, 'Hoenn'], [4, 'Sinnoh'], [5, 'Unova'],
  [6, 'Kalos'], [7, 'Alola'], [8, 'Galar'], [9, 'Paldea'],
];
