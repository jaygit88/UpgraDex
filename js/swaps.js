// Swaps tab: spare cards he can trade, with a small picture, estimated price and quantity for each,
// and a summary of what he has in total.

import { html, useState, useMemo } from '../vendor/preact-htm.js';
import { POKEDEX, BY_DEX, pad, spriteUrl } from './data.js';
import { priceKey } from './api.js';
import { usePriceMap, valueOf, useRates, money, sumCurrency, ProgressNote, PriceBlock, ChangeBadge } from './price.js';
import * as store from './store.js';
import { openSheet, toast, CardImage, RarityChip, LangBadge, setLine, Icon, speciesName } from './app.js';

function useSession(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = sessionStorage.getItem('pu-swaps:' + key); return s != null ? JSON.parse(s) : initial; } catch { return initial; }
  });
  const set = (x) => { setV(x); try { sessionStorage.setItem('pu-swaps:' + key, JSON.stringify(x)); } catch {} };
  return [v, set];
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function searchPokemon(q) {
  const s = q.trim().toLowerCase().replace(/^#0*/, '');
  if (!s) return [];
  if (/^\d+$/.test(s)) return POKEDEX.filter((p) => String(p.dex).startsWith(s)).slice(0, 8);
  return POKEDEX.filter((p) => p.name.toLowerCase().includes(s) || (p.ja && p.ja.includes(q.trim()))).slice(0, 8);
}

export function SwapsScreen() {
  const entries = store.useCollection();
  const settings = store.useSettings();
  const rates = useRates('GBP');
  const cur = sumCurrency(settings);
  const [sort, setSort] = useSession('sort', 'value');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState('');

  const swaps = useMemo(() => store.allSwaps(entries), [entries]);
  const priceState = usePriceMap(swaps.map((s) => priceKey(s.slot)));
  const rows = swaps.map((s) => {
    const each = valueOf(priceState.prices.get(priceKey(s.slot)), settings, rates);
    return { ...s, name: speciesName(s.dex), each, total: each == null ? null : each * s.slot.qty };
  });

  const count = rows.reduce((n, r) => n + r.slot.qty, 0);
  const pokemon = new Set(rows.map((r) => r.dex)).size;
  const value = rows.reduce((n, r) => n + (r.total || 0), 0);
  const unpriced = priceState.loading ? 0 : rows.filter((r) => r.each == null).length;
  const top = [...rows].filter((r) => r.each != null).sort((a, b) => b.each - a.each)[0];

  const t = q.trim().toLowerCase();
  let shown = rows.filter((r) => !t || r.name.toLowerCase().includes(t) || r.slot.name.toLowerCase().includes(t) || (r.slot.set || '').toLowerCase().includes(t));
  if (sort === 'value') shown.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.dex - b.dex);
  if (sort === 'dex') shown.sort((a, b) => a.dex - b.dex || (a.slot.set || '').localeCompare(b.slot.set || ''));
  if (sort === 'new') shown.sort((a, b) => (b.slot.added || 0) - (a.slot.added || 0));

  return html`<div class="pad narrow">
    <h1>Swaps</h1>
    <p class="muted small">Spare cards you can trade. Add them from any card (“Add to swaps”), from a scan, or below.</p>

    <div class="swap-summary">
      <div><b>${count}</b><span>${count === 1 ? 'card' : 'cards'}</span></div>
      <div><b>${pokemon}</b><span>different Pokémon</span></div>
      <div><b>${priceState.loading && swaps.length ? '…' : money(value, cur)}</b><span>estimated value</span></div>
    </div>
    ${top && html`<p class="small">⭐ Most valuable swap: <b>${top.slot.name}</b> (${top.slot.set}) — ${money(top.each, cur)}</p>`}
    <${ProgressNote} state=${priceState} what="your swaps" />

    <div class="add-swap">
      ${adding === ''
        ? html`<button class="btn primary" onClick=${() => setAdding(' ')}><${Icon} name="plus" /> Add a swap</button>
               <a class="btn" href="#/scan">📷 Scan swaps</a>
               ${swaps.length > 0 && html`<button class="btn" onClick=${() => openSheet({ kind: 'shareswaps' })}>📤 Share my swaps</button>`}`
        : html`<div class="finder">
            <input type="search" autoFocus placeholder="Which Pokémon? e.g. Pikachu" value=${adding.trim()} onInput=${(e) => setAdding(e.currentTarget.value || ' ')} />
            <div class="suggest">${searchPokemon(adding).map((p) => html`<a href=${`#/p/${p.dex}/cards/swap`}>
              <img class="sprite tiny" src=${spriteUrl(p.dex)} alt="" /> ${pad(p.dex)} ${p.name}</a>`)}</div>
            <button class="btn small" onClick=${() => setAdding('')}>Cancel</button>
          </div>`}
    </div>

    ${swaps.length > 0 && html`<div class="toolbar">
      <input type="search" placeholder="Search your swaps…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      <select value=${sort} onChange=${(e) => setSort(e.currentTarget.value)} aria-label="Sort">
        <option value="value">Most valuable</option>
        <option value="dex">Pokédex order</option>
        <option value="new">Recently added</option>
      </select>
    </div>`}

    ${swaps.length === 0 && html`<p class="muted center spaced">No swaps yet. Got a double? Open the card and tap <b>Add to swaps</b>.</p>`}

    <div class="shop-list">
      ${shown.map((r) => html`<div class="swap-row" key=${r.dex + '-' + r.index}>
        <button class="swap-main" onClick=${() => openSheet({ kind: 'swap', dex: r.dex, index: r.index })}>
          <${CardImage} card=${r.slot} className="thumb" />
          <div class="grow">
            <div><span class="muted">${pad(r.dex)}</span> <b>${r.name}</b></div>
            <div class="small">${r.slot.name}</div>
            <div class="muted small">${setLine(r.slot)}</div>
            <div class="row-wrap"><${RarityChip} rarity=${r.slot.rarity} /><${LangBadge} lang=${r.slot.lang} /></div>
          </div>
          <div class="swap-price">
            ${r.each == null ? html`<span class="muted small">${priceState.loading ? '…' : 'no price'}</span>`
              : html`<b>${money(r.total, cur)}</b><div><${ChangeBadge} id=${priceKey(r.slot)} p=${priceState.prices.get(priceKey(r.slot))} /></div>${r.slot.qty > 1 ? html`<div class="muted small">${money(r.each, cur)} each</div>` : ''}`}
          </div>
        </button>
        <div class="qty" role="group" aria-label="How many">
          <button class="icon-btn small" aria-label="One fewer" onClick=${() => store.changeSwapQty(r.dex, r.index, -1)}>−</button>
          <span class="qty-n">×${r.slot.qty}</span>
          <button class="icon-btn small" aria-label="One more" onClick=${() => store.changeSwapQty(r.dex, r.index, 1)}>+</button>
        </div>
      </div>`)}
    </div>
    ${unpriced > 0 && html`<p class="muted small">${plural(unpriced, 'swap has', 'swaps have')} no price yet, so ${unpriced === 1 ? "it isn't" : "they aren't"} in the total.</p>`}
    ${swaps.length > 0 && html`<p class="muted small">Values are typical recent sale prices (${settings.priceSource === 'tcgplayer' ? 'TCGplayer' : 'Cardmarket'}); Japanese cards use Japanese prices. Condition matters — worn cards are worth less.</p>`}
  </div>`;
}

// Details sheet for one swap.
export function SwapSheet({ dex, index }) {
  store.useCollection();
  const e = store.getEntry(dex);
  const s = (e.swaps || [])[index];
  if (!s) return html`<p class="pad">This swap has been removed.</p>`;
  const owned = e.owned;
  const canUse = !owned; // he hasn't got this Pokémon at all: the swap can fill the gap
  return html`<div class="sheet-body">
    <div class="sheet-img"><${CardImage} card=${s} q="high" /></div>
    <div class="sheet-info">
      <div class="muted">${pad(dex)} ${speciesName(dex)} · Swap ×${s.qty}</div>
      <h2>${s.name}</h2>
      <div class="muted small">${setLine(s)}</div>
      <div class="row-wrap"><${RarityChip} rarity=${s.rarity} /><${LangBadge} lang=${s.lang} /></div>
      <div class="row-wrap actions">
        <button class="btn" onClick=${() => store.changeSwapQty(dex, index, 1)}>+ One more</button>
        <button class="btn" onClick=${() => store.changeSwapQty(dex, index, -1)}>${s.qty > 1 ? '− One fewer' : 'Remove'}</button>
        ${canUse && html`<button class="btn primary" onClick=${() => {
          const before = store.getEntry(dex);
          store.updateEntry(dex, (x) => {
            const { qty, added, ...card } = x.swaps[index];
            x.owned = { ...card };
            x.swaps[index].qty -= 1;
            return x;
          });
          toast({ msg: `Moved into your collection as your ${speciesName(dex)}`, undo: () => store.setEntry(dex, before) });
        }}>Use it in my collection</button>`}
        <a class="btn" href=${`#/p/${dex}`}>Open ${speciesName(dex)}</a>
      </div>
      ${canUse && html`<p class="small ok-text">You haven't got a ${speciesName(dex)} in your collection — this swap could fill the gap!</p>`}
      <${PriceBlock} id=${priceKey(s)} cat=${s.cat} lang=${s.lang} name=${s.name} query=${`${s.name} ${s.num} ${s.set}`} />
    </div>
  </div>`;
}
