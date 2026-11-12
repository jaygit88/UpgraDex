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

// ---------- Japanese / Korean cards ----------
// Built by scripts/build-intl.mjs. Loaded only when someone looks at Japanese (or Korean) cards.
export const CATALOGUES = { ja: 'Japanese', ko: 'Korean' };
export const CAT_FOR_LANG = { JP: 'ja', KR: 'ko' };
export const LANG_FOR_CAT = { ja: 'JP', ko: 'KR' };
export const INTL_SETS = {}; // lang -> setId -> { n, d, s, o }
const intlLoads = {};

export function loadIntl(lang) {
  if (!intlLoads[lang]) {
    intlLoads[lang] = Promise.all([
      fetch(`data/sets-${lang}.json`).then((r) => r.json()),
      fetch(`data/cards-${lang}.json`).then((r) => r.json()),
    ]).then(([sets, cards]) => { INTL_SETS[lang] = sets; return { sets, cards }; })
      .catch((e) => { delete intlLoads[lang]; throw e; });
  }
  return intlLoads[lang];
}

// A Pokémon's Japanese (or Korean) cards, as the same card objects the English list uses, newest first.
export async function intlCardsFor(lang, dex) {
  const { sets, cards } = await loadIntl(lang);
  return (cards[dex] || []).map(([id, num, name, hasPic]) => {
    const setId = id.slice(0, id.length - String(num).length - 1);
    const s = sets[setId] || {};
    return {
      id, name, num, setId, cat: lang, rarity: '',
      set: s.n || setId, date: s.d || '', code: setId, total: s.o || 0,
      img: hasPic && s.s ? `https://assets.tcgdex.net/${lang}/${s.s}/${setId}/${num}` : '',
    };
  });
}

export async function intlCount(lang, dex) {
  try { const { cards } = await loadIntl(lang); return (cards[dex] || []).length; } catch { return 0; }
}

export const GENS = [
  [1, 'Kanto'], [2, 'Johto'], [3, 'Hoenn'], [4, 'Sinnoh'], [5, 'Unova'],
  [6, 'Kalos'], [7, 'Alola'], [8, 'Galar'], [9, 'Paldea'],
];
