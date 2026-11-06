// Rarity helpers: how fancy a rarity is (for sorting), a tidy label and a short code.

const RARITIES = {
  'none': [0, 'None', ''],
  'common': [1, 'Common', 'C'],
  'uncommon': [2, 'Uncommon', 'U'],
  'rare': [3, 'Rare', 'R'],
  'promo': [3, 'Promo', 'PR'],
  'holo rare': [4, 'Holo Rare', 'H'],
  'rare holo': [4, 'Holo Rare', 'H'],
  'classic collection': [5, 'Classic Collection', 'CC'],
  'rare holo lv.x': [5, 'Holo Rare LV.X', 'LV.X'],
  'rare prime': [5, 'Rare PRIME', 'PRIME'],
  'legend': [6, 'LEGEND', 'LEGEND'],
  'holo rare v': [5, 'Holo Rare V', 'V'],
  'holo rare vmax': [5, 'Holo Rare VMAX', 'VMAX'],
  'holo rare vstar': [5, 'Holo Rare VSTAR', 'VSTAR'],
  'double rare': [5, 'Double Rare', 'RR'],
  'ace spec rare': [5, 'ACE SPEC Rare', 'ACE'],
  'radiant rare': [6, 'Radiant Rare', 'K'],
  'amazing rare': [6, 'Amazing Rare', 'A'],
  'pikachu rare': [6, 'Pikachu Rare', 'PK'],
  'full art trainer': [6, 'Full Art Trainer', 'FA'],
  'ultra rare': [6, 'Ultra Rare', 'UR'],
  'shiny rare': [6, 'Shiny Rare', 'S'],
  'shiny rare v': [7, 'Shiny Rare V', 'SV'],
  'shiny rare vmax': [7, 'Shiny Rare VMAX', 'SV'],
  'illustration rare': [7, 'Illustration Rare', 'IR'],
  'shiny ultra rare': [8, 'Shiny Ultra Rare', 'SSR'],
  'secret rare': [8, 'Secret Rare', 'SR'],
  'hyper rare': [8, 'Hyper Rare', 'HR'],
  'black white rare': [8, 'Black White Rare', 'BWR'],
  'special illustration rare': [9, 'Special Illustration Rare', 'SIR'],
  'mega hyper rare': [9, 'Mega Hyper Rare', 'MHR'],
  'crown': [9, 'Crown Rare', 'CR'],
};

function info(r) {
  if (!r) return null;
  return RARITIES[String(r).toLowerCase()] || null;
}

export function rarityRank(r) {
  const i = info(r);
  return i ? i[0] : 3;
}

export function rarityLabel(r) {
  if (!r) return 'Unknown rarity';
  const i = info(r);
  if (i) return i[1];
  return String(r).replace(/\b\w/g, (c) => c.toUpperCase());
}

export function rarityShort(r) {
  const i = info(r);
  return i ? i[2] : '';
}

// A colour bucket for the rarity chip.
export function rarityTier(r) {
  const n = rarityRank(r);
  if (n >= 9) return 'gold';
  if (n >= 7) return 'purple';
  if (n >= 5) return 'blue';
  if (n >= 4) return 'green';
  return 'grey';
}

// Rarities that are usually what people mean by an "upgrade".
export const FANCY_MIN_RANK = 5;
