// Collection summary: estimated value, most valuable cards and some fun breakdowns.

import { html, useMemo } from '../vendor/preact-htm.js';
import { POKEDEX, GENS, pad } from './data.js';
import { usePriceMap, valueOf, useRates, money, sumCurrency, ProgressNote } from './price.js';
import { rarityLabel, rarityRank } from './rarity.js';
import * as store from './store.js';
import { openSheet, CardImage, Icon } from './app.js';

const LANG_NAMES = { EN: 'English', JP: 'Japanese', KR: 'Korean' };

// A labelled bar list: one series, so one colour; the numbers are printed so colour never carries meaning alone.
function Bars({ rows, format = (v) => v, max }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return html`<div class="bars" role="table">
    ${rows.map((r) => html`<div class="bar-row" role="row" title=${r.title || ''}>
      <span class="bar-label" role="cell">${r.label}</span>
      <span class="bar-track" role="cell"><span class="bar-fill" style=${`width:${Math.max(r.value ? 2 : 0, (r.value / (r.total || top)) * 100)}%`}></span></span>
      <span class="bar-value" role="cell">${format(r.value, r)}</span>
    </div>`)}
  </div>`;
}

export function SummaryScreen() {
  const entries = store.useCollection();
  const settings = store.useSettings();
  const rates = useRates('GBP');
  const cur = sumCurrency(settings);

  const owned = useMemo(() => POKEDEX.map((p) => ({ p, e: entries[p.dex] })).filter((x) => x.e?.owned), [entries]);
  const picked = owned.filter((x) => !x.e.owned.unknown);
  const priceable = picked.filter((x) => x.e.owned.id && !x.e.owned.custom);
  const topPicks = useMemo(() => POKEDEX.map((p) => entries[p.dex]?.ups?.[0]).filter((u) => u && !u.custom), [entries]);
  const priceState = usePriceMap([...priceable.map((x) => x.e.owned.id), ...topPicks.map((u) => u.id)]);

  const valued = priceable.map((x) => ({ ...x, value: valueOf(priceState.prices.get(x.e.owned.id), settings, rates) })).filter((x) => x.value != null);
  const total = valued.reduce((s, x) => s + x.value, 0);
  const top5 = [...valued].sort((a, b) => b.value - a.value).slice(0, 5);
  const wishCost = topPicks.reduce((s, u) => s + (valueOf(priceState.prices.get(u.id), settings, rates) ?? 0), 0);

  // Breakdowns
  const byRarity = new Map();
  for (const x of picked) {
    const label = rarityLabel(x.e.owned.rarity || '');
    const r = byRarity.get(label) || { label, value: 0, rank: rarityRank(x.e.owned.rarity) };
    r.value++;
    byRarity.set(label, r);
  }
  const rarityRows = [...byRarity.values()].sort((a, b) => b.rank - a.rank || b.value - a.value);
  const langRows = ['EN', 'JP', 'KR'].map((l) => ({ label: LANG_NAMES[l], value: owned.filter((x) => (x.e.owned.lang || 'EN') === l).length }));
  const genRows = GENS.map(([g, name]) => {
    const all = POKEDEX.filter((p) => p.gen === g);
    const have = all.filter((p) => entries[p.dex]?.owned).length;
    return { label: `Gen ${g} · ${name}`, value: have, total: all.length };
  });
  const bySet = new Map();
  for (const x of picked) {
    const k = x.e.owned.set || 'Unknown';
    bySet.set(k, (bySet.get(k) || 0) + 1);
  }
  const setRows = [...bySet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  const dated = picked.filter((x) => x.e.owned.date && !x.e.owned.date.startsWith('9999'));
  const oldest = dated.sort((a, b) => a.e.owned.date.localeCompare(b.e.owned.date))[0];
  const fancy = picked.filter((x) => rarityRank(x.e.owned.rarity) >= 7).length;

  return html`<div class="pad narrow summary">
    <div class="row-wrap"><a class="icon-btn" href="#/" aria-label="Back"><${Icon} name="back" /></a><h1 class="grow">Collection summary</h1></div>

    <section class="hero-value">
      <div class="muted small">Estimated value of your collection</div>
      <div class="hero-number">${priceState.loading ? '…' : money(total, cur)}</div>
      <div class="muted small">${valued.length} card${valued.length === 1 ? '' : 's'} priced${picked.length < owned.length ? ` · ${owned.length - picked.length} not picked yet, so not counted` : ''}</div>
      <${ProgressNote} state=${priceState} what="your cards" />
    </section>

    <div class="stats">
      <div><b>${owned.length}</b><span>of ${POKEDEX.length} Pokémon</span></div>
      <div><b>${fancy}</b><span>Illustration Rare or better</span></div>
      <div><b>${priceState.loading ? '…' : money(wishCost, cur)}</b><span>to buy every top pick</span></div>
    </div>

    <h2>Most valuable cards</h2>
    ${top5.length === 0 && html`<p class="muted small">${priceState.loading ? 'Working it out…' : 'Pick your exact cards on each Pokémon’s page to see what they’re worth.'}</p>`}
    <ol class="top-list">
      ${top5.map((x, i) => html`<li key=${x.p.dex}>
        <button class="shop-row" onClick=${() => openSheet({ kind: 'slot', dex: x.p.dex, where: 'owned' })}>
          <span class="set-rank">${i + 1}</span>
          <${CardImage} card=${x.e.owned} className="thumb" />
          <div class="grow">
            <div><span class="muted">${pad(x.p.dex)}</span> <b>${x.e.owned.name}</b></div>
            <div class="muted small">${x.e.owned.set} · ${rarityLabel(x.e.owned.rarity)}</div>
          </div>
          <span class="price-tag"><b>${money(x.value, cur)}</b></span>
        </button>
      </li>`)}
    </ol>

    <h2>Pokédex by generation</h2>
    <p class="muted small">How much of each generation you've collected (a full bar is complete).</p>
    <${Bars} rows=${genRows} format=${(v, r) => `${v}/${r.total}`} />

    ${rarityRows.length > 0 && html`<h2>Cards by rarity</h2><${Bars} rows=${rarityRows} />`}

    <h2>Languages</h2>
    <${Bars} rows=${langRows} />

    ${setRows.length > 0 && html`<h2>Sets you have most cards from</h2><${Bars} rows=${setRows} />`}

    ${oldest && html`<h2>Fun facts</h2>
      <ul class="small facts">
        <li>Oldest card: <b>${oldest.e.owned.name}</b> from ${oldest.e.owned.set} (${oldest.e.owned.date.slice(0, 4)}).</li>
        ${bySet.size > 0 && html`<li>Your cards come from <b>${bySet.size}</b> different sets.</li>`}
      </ul>`}
    <p class="muted small">Values are typical recent sale prices for English cards in good condition (${settings.priceSource === 'tcgplayer' ? 'TCGplayer' : 'Cardmarket'}). Japanese and Korean cards are valued as their English version.</p>
  </div>`;
}
