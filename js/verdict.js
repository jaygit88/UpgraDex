// "Do I need this?" — compares a card he's looking at with what he already has.
// Rarity decides first (rarer = upgrade); when the rarity is the same, price decides.

import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { getPrices, priceKey } from './api.js';
import { valueOf, useRates, money, sumCurrency } from './price.js';
import { rarityRank, rarityLabel } from './rarity.js';
import * as store from './store.js';
import { BY_DEX } from './data.js';

const LANG_NAMES = { EN: 'English', JP: 'Japanese', KR: 'Korean' };
const SAME_PRICE_BAND = 0.2; // within 20% counts as "about the same"

async function pricesOf(card) {
  const key = priceKey(card);
  if (!key) return null;
  try { return await getPrices(key); } catch { return null; }
}

// kind: have | listed | missing | unpicked | upgrade | not-upgrade | similar
export async function verdictFor(dex, cardIn, lang, settings, rates) {
  let card = cardIn;
  const e = store.getEntry(dex);
  const name = BY_DEX.get(+dex)?.name || 'this Pokémon';
  let owned = e.owned;
  if (owned && !owned.unknown && store.sameCard(owned, card)) {
    if (owned.lang && lang && owned.lang !== lang) {
      return { kind: 'similar', title: 'Same card as yours', detail: `Yours is ${LANG_NAMES[owned.lang]}, this one is ${LANG_NAMES[lang]}.` };
    }
    return { kind: 'have', title: "You've already got this one", detail: 'This is the card in your collection.' };
  }
  const up = e.ups.findIndex((u) => store.sameCard(u, card));
  if (up >= 0) return { kind: 'listed', title: `On your wish list — upgrade #${up + 1}!`, detail: `You picked this as your ${['top', 'second', 'third'][up] || ''} choice for ${name}.` };
  if (!owned) return { kind: 'missing', title: `Missing Pokémon — grab it!`, detail: `You haven't got any ${name} card yet. Any card fills the gap.` };
  if (owned.unknown) return { kind: 'unpicked', title: `You've got a ${name} already`, detail: "Pick which card you've got (on the Pokémon's page) and the app can tell you if this one's better." };

  const [pm, pt] = await Promise.all([pricesOf(owned), pricesOf(card)]);
  const mine = pm ? valueOf(pm, settings, rates) : null;
  const theirs = pt ? valueOf(pt, settings, rates) : null;
  // Japanese cards get their rarity from the same lookup as their price.
  owned = { ...owned, rarity: owned.rarity || pm?.rarity || '' };
  card = { ...card, rarity: card.rarity || pt?.rarity || '' };
  const known = (r) => r && r !== 'None';
  const rMine = rarityRank(owned.rarity), rNew = rarityRank(card.rarity);
  const compare = { mine: { card: owned, price: mine }, theirs: { card, price: theirs } };
  // Rarity first — but only when both rarities are known (some Japanese cards have none); otherwise price decides.
  const byRarity = known(owned.rarity) && known(card.rarity);
  if (byRarity && rNew > rMine) {
    return { kind: 'upgrade', title: 'Upgrade!', detail: `${rarityLabel(card.rarity)} is rarer than your ${rarityLabel(owned.rarity)}.`, compare };
  }
  if (byRarity && rNew < rMine) {
    return { kind: 'not-upgrade', title: 'Not an upgrade', detail: `Your ${rarityLabel(owned.rarity)} is rarer than this ${rarityLabel(card.rarity)}.`, compare };
  }
  if (mine != null && theirs != null) {
    if (theirs > mine * (1 + SAME_PRICE_BAND)) return { kind: 'upgrade', title: 'Upgrade!', detail: byRarity ? 'Same rarity as yours, but worth more.' : 'Worth more than yours.', compare };
    if (theirs < mine * (1 - SAME_PRICE_BAND)) return { kind: 'not-upgrade', title: 'Not an upgrade', detail: byRarity ? 'Same rarity as yours, and yours is worth more.' : 'Yours is worth more.', compare };
  }
  if (!byRarity && mine != null && theirs != null) {
    if (theirs > mine * (1 + SAME_PRICE_BAND)) return { kind: 'upgrade', title: 'Upgrade!', detail: 'Worth more than yours.', compare };
    if (theirs < mine * (1 - SAME_PRICE_BAND)) return { kind: 'not-upgrade', title: 'Not an upgrade', detail: 'Yours is worth more.', compare };
    return { kind: 'similar', title: 'About the same as yours', detail: 'A similar price to yours.', compare };
  }
  return { kind: 'similar', title: 'About the same as yours', detail: byRarity ? `Same rarity (${rarityLabel(card.rarity)})${mine != null && theirs != null ? ' and a similar price' : ''}.` : "Can't compare these two yet.", compare };
}

const ICONS = { have: '✓', listed: '★', missing: '!', unpicked: '?', upgrade: '⬆', 'not-upgrade': '✕', similar: '≈' };

export function useVerdict(dex, card, lang) {
  const settings = store.useSettings();
  const entries = store.useCollection();
  const rates = useRates('GBP');
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!dex || !card) { setV(null); return; }
    let live = true;
    setV(null);
    verdictFor(dex, card, lang, settings, rates).then((r) => live && setV(r));
    return () => { live = false; };
  }, [dex, card && card.id, lang, entries, settings.priceSource, settings.currency, rates]);
  return v;
}

export function VerdictBanner({ dex, card, lang, compact = false }) {
  const settings = store.useSettings();
  const v = useVerdict(dex, card, lang);
  if (!card) return null;
  if (!v) return html`<div class="verdict v-loading">Checking your collection…</div>`;
  const cur = sumCurrency(settings);
  const p = (x) => (x == null ? 'no price' : money(x, cur));
  if (compact) return html`<span class=${`verdict-chip v-${v.kind}`}>${ICONS[v.kind]} ${v.title}</span>`;
  return html`<div class=${`verdict v-${v.kind}`} role="status">
    <div class="verdict-title"><span class="verdict-icon" aria-hidden="true">${ICONS[v.kind]}</span> ${v.title}</div>
    <div class="small">${v.detail}</div>
    ${v.compare && html`<div class="verdict-compare small">
      <span>Yours: <b>${v.compare.mine.card.set}</b> · ${rarityLabel(v.compare.mine.card.rarity)} · ${p(v.compare.mine.price)}</span>
      <span>This: <b>${v.compare.theirs.card.set}</b> · ${rarityLabel(v.compare.theirs.card.rarity)} · ${p(v.compare.theirs.price)}</span>
    </div>`}
  </div>`;
}
