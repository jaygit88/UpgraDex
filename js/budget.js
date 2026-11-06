// Budget tab: "I've got £10 — what should I get?" plus "which sets hold most of my upgrades?".

import { html, useState, useMemo } from '../vendor/preact-htm.js';
import { POKEDEX, SETS, pad } from './data.js';
import { usePriceMap, valueOf, useRates, money, sumCurrency, ProgressNote } from './price.js';
import { rarityLabel } from './rarity.js';
import * as store from './store.js';
import { openSheet, CardImage, RarityChip, LangBadge, setLine } from './app.js';

function useSession(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = sessionStorage.getItem('pu-budget:' + key); return s != null ? JSON.parse(s) : initial; } catch { return initial; }
  });
  const set = (x) => { setV(x); try { sessionStorage.setItem('pu-budget:' + key, JSON.stringify(x)); } catch {} };
  return [v, set];
}

// All planned upgrades as { dex, name, rank, slot }.
function allUpgrades(entries) {
  const out = [];
  for (const p of POKEDEX) {
    const e = entries[p.dex];
    if (!e?.ups?.length) continue;
    e.ups.forEach((u, i) => out.push({ dex: p.dex, name: p.name, rank: i + 1, slot: u }));
  }
  return out;
}

// Greedy pick: at most one upgrade per Pokémon, stay within budget.
//   "best": top picks first (then cheapest)   "most": cheapest first (most cards for the money)
export function planBudget(candidates, budget, strategy) {
  const sorted = [...candidates].sort((a, b) => (strategy === 'most'
    ? a.price - b.price || a.rank - b.rank
    : a.rank - b.rank || a.price - b.price));
  const taken = new Set();
  const picks = [];
  let left = budget;
  for (const c of sorted) {
    if (taken.has(c.dex) || c.price > left) continue;
    picks.push(c);
    taken.add(c.dex);
    left -= c.price;
  }
  picks.sort((a, b) => a.dex - b.dex);
  // The cheapest thing he can't quite afford yet (for a Pokémon not already in the plan).
  const nearMiss = sorted.filter((c) => !taken.has(c.dex) && c.price > left).sort((a, b) => a.price - b.price)[0] || null;
  return { picks, spent: budget - left, left, nearMiss };
}

export function BudgetScreen() {
  const entries = store.useCollection();
  const [view, setView] = useSession('view', 'plan');
  return html`<div class="pad narrow">
    <h1>Budget</h1>
    <div class="seg" role="tablist">
      <button role="tab" aria-selected=${view === 'plan'} class=${view === 'plan' ? 'on' : ''} onClick=${() => setView('plan')}>💷 What can I get?</button>
      <button role="tab" aria-selected=${view === 'sets'} class=${view === 'sets' ? 'on' : ''} onClick=${() => setView('sets')}>📦 Which packs to buy</button>
    </div>
    ${view === 'plan' ? html`<${Planner} entries=${entries} />` : html`<${BestSets} entries=${entries} />`}
  </div>`;
}

function Planner({ entries }) {
  const settings = store.useSettings();
  const rates = useRates('GBP');
  const cur = sumCurrency(settings);
  const [amount, setAmount] = useSession('amount', 10);
  const [which, setWhich] = useSession('which', 'all');
  const [strategy, setStrategy] = useSession('strategy', 'best');

  const ups = useMemo(() => allUpgrades(entries).filter((u) => !u.slot.custom && (which === 'all' || u.rank === 1)), [entries, which]);
  const priceState = usePriceMap(ups.map((u) => u.slot.id));
  const candidates = ups.map((u) => ({ ...u, price: valueOf(priceState.prices.get(u.slot.id), settings, rates) })).filter((u) => u.price != null);
  const unpriced = priceState.loading ? 0 : ups.length - candidates.length;
  const budget = Math.max(0, Number(amount) || 0);
  const plan = planBudget(candidates, budget, strategy);
  const missing = POKEDEX.filter((p) => !entries[p.dex]?.owned).length;
  const sym = money(0, cur).replace(/[\d.,\s]/g, '');

  if (!allUpgrades(entries).length) {
    return html`<p class="muted">No upgrades planned yet. Add some on each Pokémon's page, then come back to plan what to buy.</p>`;
  }
  return html`<div>
    <label class="budget-amount">How much has he got to spend?
      <div class="money-input"><span>${sym}</span>
        <input type="number" inputmode="decimal" min="0" step="1" value=${amount} onInput=${(e) => setAmount(e.currentTarget.value)} />
      </div>
    </label>
    <div class="chips">
      ${[5, 10, 20, 50].map((n) => html`<button class=${`chip ${budget === n ? 'on' : ''}`} onClick=${() => setAmount(n)}>${money(n, cur).replace(/\.00$/, '')}</button>`)}
    </div>
    <div class="chips">
      <button class=${`chip ${which === 'all' ? 'on' : ''}`} onClick=${() => setWhich('all')}>Any of his top 3</button>
      <button class=${`chip ${which === 'top' ? 'on' : ''}`} onClick=${() => setWhich('top')}>Top picks only</button>
    </div>
    <div class="chips">
      <button class=${`chip ${strategy === 'best' ? 'on' : ''}`} onClick=${() => setStrategy('best')}>⭐ Best picks first</button>
      <button class=${`chip ${strategy === 'most' ? 'on' : ''}`} onClick=${() => setStrategy('most')}>🔢 Most cards for the money</button>
    </div>

    <${ProgressNote} state=${priceState} what="his upgrades" />

    ${!priceState.loading && html`<div class="budget-summary">
      <div><b>${plan.picks.length}</b><span>upgrade${plan.picks.length === 1 ? '' : 's'}</span></div>
      <div><b>${money(plan.spent, cur)}</b><span>spent</span></div>
      <div><b>${money(plan.left, cur)}</b><span>left over</span></div>
    </div>`}

    ${!priceState.loading && plan.picks.length === 0 && html`<p class="muted">Nothing on his list fits ${money(budget, cur)}. The cheapest is ${candidates.length ? money(Math.min(...candidates.map((c) => c.price)), cur) : '–'}.</p>`}

    ${!priceState.loading && plan.nearMiss && html`<p class="near-miss">💡 Just out of reach: <b>${plan.nearMiss.name}</b> (${plan.nearMiss.slot.set}) for ${money(plan.nearMiss.price, cur)} — he'd need <b>${money(plan.nearMiss.price - plan.left, cur)}</b> more.</p>`}

    <div class="shop-list">
      ${plan.picks.map((c) => html`<button class="shop-row" key=${c.dex + '-' + c.rank} onClick=${() => openSheet({ kind: 'slot', dex: c.dex, where: c.rank - 1 })}>
        <${CardImage} card=${c.slot} className="thumb" />
        <div class="grow">
          <div><span class="muted">${pad(c.dex)}</span> <b>${c.name}</b> <span class="badge up-badge">⬆${c.rank}</span></div>
          <div class="small">${c.slot.name}</div>
          <div class="muted small">${setLine(c.slot)}</div>
          <div class="row-wrap"><${RarityChip} rarity=${c.slot.rarity} /><${LangBadge} lang=${c.slot.lang} /></div>
        </div>
        <span class="price-tag"><b>${money(c.price, cur)}</b></span>
      </button>`)}
    </div>
    ${unpriced > 0 && html`<p class="muted small">${unpriced} upgrade${unpriced === 1 ? " has" : 's have'} no price yet, so ${unpriced === 1 ? "it isn't" : "they aren't"} included.</p>`}
    ${missing > 0 && html`<p class="small">Don't forget: he's still missing <a href="#/shop">${missing} Pokémon</a> — any card fills those gaps, usually for pennies.</p>`}
    <p class="muted small">Prices are typical recent sale prices; shops often charge a little more.</p>
  </div>`;
}

function BestSets({ entries }) {
  const [open, setOpen] = useState(null);
  const groups = useMemo(() => {
    const m = new Map();
    for (const u of allUpgrades(entries)) {
      const key = u.slot.setId || u.slot.set || 'unknown';
      if (!m.has(key)) m.set(key, { key, set: u.slot.set || 'Unknown set', setId: u.slot.setId, date: u.slot.date || '', ups: [] });
      m.get(key).ups.push(u);
    }
    return [...m.values()].sort((a, b) => b.ups.length - a.ups.length || b.ups.filter((u) => u.rank === 1).length - a.ups.filter((u) => u.rank === 1).length);
  }, [entries]);
  if (!groups.length) return html`<p class="muted">No upgrades planned yet.</p>`;
  const max = groups[0].ups.length;
  return html`<div>
    <p class="small">Sets with the most of his upgrades — the best packs to open if he's buying boosters rather than single cards.</p>
    <div class="set-list">
      ${groups.slice(0, 25).map((g, i) => {
        const top = g.ups.filter((u) => u.rank === 1).length;
        const s = SETS[g.setId];
        return html`<div class="set-row" key=${g.key}>
          <button class="set-main" aria-expanded=${open === g.key} onClick=${() => setOpen(open === g.key ? null : g.key)}>
            <span class="set-rank">${i + 1}</span>
            <span class="grow">
              <b>${g.set}</b>${s?.a ? html` <span class="muted small">(${s.a})</span>` : ''}
              <span class="muted small"> · ${g.date && !g.date.startsWith('9999') ? g.date.slice(0, 4) : ''}</span>
              <span class="bar-track"><span class="bar-fill" style=${`width:${(g.ups.length / max) * 100}%`}></span></span>
            </span>
            <span class="set-count"><b>${g.ups.length}</b> upgrade${g.ups.length === 1 ? '' : 's'}${top ? html`<br /><span class="small muted">${top} top pick${top === 1 ? '' : 's'}</span>` : ''}</span>
          </button>
          ${open === g.key && html`<div class="cand-strip">
            ${g.ups.map((u) => html`<button class="cand" onClick=${() => openSheet({ kind: 'slot', dex: u.dex, where: u.rank - 1 })}>
              <${CardImage} card=${u.slot} /><span class="small">${u.name}<br />⬆${u.rank} · ${rarityLabel(u.slot.rarity)}</span>
            </button>`)}
          </div>`}
        </div>`;
      })}
    </div>
    ${groups.length > 25 && html`<p class="muted small">…and ${groups.length - 25} more sets with one or two each.</p>`}
  </div>`;
}
