// Binder map: where each Pokémon's card goes, given the binders he keeps the collection in.
// Cards go in National Pokédex order across the binders, one pocket each.

import { html, useState } from '../vendor/preact-htm.js';
import { POKEDEX, BY_DEX, pad, spriteUrl } from './data.js';
import * as store from './store.js';
import { CardImage, Icon, go, toast } from './app.js';

const POCKET_LAYOUTS = { 4: [2, 2], 9: [3, 3], 12: [3, 4], 16: [4, 4], 18: [3, 3] }; // [columns, rows] per page side
// Page layouts to choose from in Settings: [across, down].
export const LAYOUT_CHOICES = [[2, 2], [3, 3], [4, 3], [3, 4], [4, 4]];

// [across, down] for a binder: what was chosen, or the usual layout for its number of pockets.
export function layoutOf(b) {
  if (b && b.cols > 0 && b.rows > 0) return [b.cols, b.rows];
  const n = b?.pockets || 9;
  return POCKET_LAYOUTS[n] || [Math.ceil(Math.sqrt(n)), Math.ceil(n / Math.ceil(Math.sqrt(n)))];
}

export function binderSettings(settings) {
  return {
    binders: Array.isArray(settings.binders) ? settings.binders.filter((b) => b && b.pages > 0 && b.pockets > 0) : [],
    gaps: settings.binderGaps !== false, // leave a pocket free for each missing Pokémon
  };
}

// Where the card for this Pokémon goes, or null if no binders are set up.
export function binderSpot(dex, settings, entries = store.allEntries()) {
  const { binders, gaps } = binderSettings(settings);
  if (!binders.length) return null;
  let index;
  if (gaps) {
    index = dex - 1;
  } else {
    index = 0;
    for (const p of POKEDEX) {
      if (p.dex >= dex) break;
      if (entries[p.dex]?.owned) index++;
    }
  }
  for (let b = 0; b < binders.length; b++) {
    const { pages, pockets, name } = binders[b];
    const capacity = pages * pockets;
    if (index < capacity) {
      const page = Math.floor(index / pockets) + 1;
      const pocket = (index % pockets) + 1;
      const [cols, rows] = layoutOf(binders[b]);
      const row = Math.floor((pocket - 1) / cols) + 1;
      const col = ((pocket - 1) % cols) + 1;
      return { binder: b + 1, name: name || `Binder ${b + 1}`, page, pocket, row, col, cols, rows };
    }
    index -= capacity;
  }
  return { full: true };
}

function where(s) {
  const rowWord = s.row === 1 ? 'top row' : s.row === s.rows ? 'bottom row' : s.rows === 3 ? 'middle row' : `row ${s.row}`;
  const colWord = s.cols === 3 ? ['left', 'middle', 'right'][s.col - 1] : s.cols === 2 ? ['left', 'right'][s.col - 1]
    : s.col === 1 ? 'far left' : s.col === s.cols ? 'far right' : `${s.col}${['st', 'nd', 'rd'][s.col - 1] || 'th'} from left`;
  return rowWord === 'middle row' && colWord === 'middle' ? 'right in the middle' : `${rowWord}, ${colWord}`;
}

// "📒 Binder 1 · page 11 · pocket 4 (middle left)" — shown on a Pokémon's page and when saving cards.
export function BinderSpot({ dex, compact = false }) {
  const settings = store.useSettings();
  store.useCollection();
  const s = binderSpot(dex, settings);
  if (!s) return null;
  if (s.full) return html`<div class="binder-spot small">📒 Not enough room in the binders set up in Settings</div>`;
  return html`<a class=${`binder-spot ${compact ? 'small' : ''}`} href=${`#/binder/${s.binder - 1}/${s.page - 1}/${dex}`}>
    📒 <b>${s.name}</b> · page ${s.page} · pocket ${s.pocket} <span class="muted">(${where(s)})</span> ›
  </a>`;
}

export function binderText(dex, settings) {
  const s = binderSpot(dex, settings);
  if (!s || s.full) return '';
  return `${s.name}, page ${s.page}, pocket ${s.pocket}`;
}

// ---------- Settings section ----------

export function BinderSettings() {
  const settings = store.useSettings();
  const { binders, gaps } = binderSettings(settings);
  const [list, setList] = useState(binders.length ? binders : []);
  const save = (next, nextGaps = gaps) => {
    setList(next);
    store.updateSettings({ binders: next, binderGaps: nextGaps });
  };
  const capacity = list.reduce((n, b) => n + (b.pages || 0) * (b.pockets || 0), 0);
  const need = gaps ? POKEDEX.length : Object.values(store.allEntries()).filter((e) => e.owned).length;

  return html`<section>
    <h2>Binders</h2>
    <p class="small">Tell the app how the collection is stored and it'll show where each card goes (in Pokédex order).
      Count the front and back of a sheet as two pages.</p>
    ${list.map((b, i) => html`<div class="binder-row" key=${i}>
      <input aria-label="Binder name" value=${b.name || ''} placeholder=${`Binder ${i + 1}`}
        onChange=${(e) => save(list.map((x, j) => (j === i ? { ...x, name: e.currentTarget.value } : x)))} />
      <label class="inline">Pages <input type="number" min="1" inputmode="numeric" value=${b.pages}
        onChange=${(e) => save(list.map((x, j) => (j === i ? { ...x, pages: Math.max(1, +e.currentTarget.value || 1) } : x)))} /></label>
      <label class="inline">Cards per page
        <select value=${layoutOf(b).join('x')} onChange=${(e) => {
          const [cols, rows] = e.currentTarget.value.split('x').map(Number);
          save(list.map((x, j) => (j === i ? { ...x, cols, rows, pockets: cols * rows } : x)));
        }}>
          ${LAYOUT_CHOICES.map(([c, r]) => html`<option value=${`${c}x${r}`}>${c * r} – ${c} across, ${r} down</option>`)}
        </select></label>
      <button class="icon-btn small" aria-label="Remove binder" onClick=${() => save(list.filter((_, j) => j !== i))}>✕</button>
    </div>`)}
    <div class="row-wrap">
      <button class="btn" onClick=${() => save([...list, { name: '', pages: 40, pockets: 9, cols: 3, rows: 3 }])}>+ Add a binder</button>
    </div>
    <label class="check"><input type="checkbox" checked=${gaps} onChange=${(e) => save(list, e.currentTarget.checked)} />
      Leave an empty pocket for each missing Pokémon</label>
    ${list.length > 0 && html`<p class=${`small ${capacity < need ? 'error' : 'muted'}`}>
      Room for ${capacity} cards — ${need} needed${capacity < need ? '. Add pages or another binder.' : '.'}</p>`}
    <p class="muted small">Binder setup is saved on this device.</p>
  </section>`;
}

// ---------- Binder view: the pages as they look, pocket by pocket ----------

// Every binder's pages, each a list of pockets holding a dex number (or null for a spare pocket).
export function binderLayout(settings, entries = store.allEntries()) {
  const { binders, gaps } = binderSettings(settings);
  const order = gaps ? POKEDEX.map((p) => p.dex) : POKEDEX.filter((p) => entries[p.dex]?.owned).map((p) => p.dex);
  let i = 0;
  return binders.map((b, n) => {
    const pages = [];
    for (let pg = 0; pg < b.pages; pg++) {
      const pockets = [];
      for (let k = 0; k < b.pockets; k++) pockets.push(i < order.length ? order[i++] : null);
      pages.push(pockets);
    }
    const [cols] = layoutOf(b);
    return { name: b.name || `Binder ${n + 1}`, pages, cols };
  });
}

function Pocket({ dex, entry, highlight }) {
  if (dex == null) return html`<div class="pocket spare" aria-label="Spare pocket"></div>`;
  const p = BY_DEX.get(dex);
  const owned = entry?.owned;
  const label = `${pad(dex)} ${p?.name || ''}${owned ? '' : ' – missing'}`;
  return html`<a class=${`pocket ${owned ? 'filled' : 'gap'} ${highlight ? 'hl' : ''}`} href=${`#/p/${dex}`} title=${label} aria-label=${label}>
    ${owned && !owned.unknown
      ? html`<${CardImage} card=${owned} />`
      : html`<div class="pocket-empty">
          <img class=${`sprite ${owned ? '' : 'faded'}`} src=${spriteUrl(dex)} alt="" loading="lazy" />
          <span class="pocket-num">${pad(dex)}</span>
          <span class="pocket-name">${p?.name}</span>
          <span class="pocket-tag">${owned ? 'got it · pick card' : 'missing'}</span>
        </div>`}
  </a>`;
}

function BinderPage({ binder, index, entries, highlight }) {
  const pockets = binder.pages[index];
  if (!pockets) return html`<div class="binder-page blank"></div>`;
  const used = pockets.filter((d) => d != null);
  const missing = used.filter((d) => !entries[d]?.owned);
  return html`<div class="binder-page">
    <div class="page-head"><b>Page ${index + 1}</b>
      <span class=${`small ${missing.length ? 'warn-text' : 'muted'}`}>${used.length === 0 ? 'empty' : missing.length ? `${missing.length} missing` : '✓ full'}</span></div>
    <div class="pockets" style=${`grid-template-columns: repeat(${binder.cols}, 1fr)`}>
      ${pockets.map((d, k) => html`<${Pocket} key=${k} dex=${d} entry=${d != null ? entries[d] : null} highlight=${d === highlight} />`)}
    </div>
  </div>`;
}

export function BinderScreen({ binder: bParam = 0, page: pParam = 0, dex: hlDex = 0 }) {
  const settings = store.useSettings();
  const entries = store.useCollection();
  const layout = binderLayout(settings, entries);
  const wide = typeof matchMedia === 'function' && matchMedia('(min-width: 760px)').matches;
  const [q, setQ] = useState('');

  if (!layout.length) {
    const quick = (cols, rows) => store.updateSettings({ binders: [{ name: 'My binder', pages: Math.ceil(POKEDEX.length / (cols * rows)), pockets: cols * rows, cols, rows }], binderGaps: true });
    return html`<div class="pad narrow">
      <div class="row-wrap"><a class="icon-btn" href="#/" aria-label="Back"><${Icon} name="back" /></a><h1 class="grow">Binder view</h1></div>
      <p>Tell the app how you keep your cards and it'll show your binder pages, with the gaps to fill.</p>
      <p class="small">How are the cards laid out on one page?</p>
      <div class="row-wrap">
        ${[[3, 3], [4, 3], [3, 4], [4, 4]].map(([c, r]) => html`<button class="btn" onClick=${() => quick(c, r)}>${c * r} cards: ${c} across, ${r} down</button>`)}
        <a class="btn" href="#/settings">More choices in Settings</a>
      </div>
    </div>`;
  }

  const b = Math.min(Math.max(0, bParam), layout.length - 1);
  const binder = layout[b];
  const step = wide ? 2 : 1;
  // On a tablet show two pages side by side; start each spread on an odd page (1–2, 3–4 …).
  let page = Math.min(Math.max(0, pParam), binder.pages.length - 1);
  if (wide) page -= page % 2;
  const goTo = (bb, pp, d = hlDex) => go(`#/binder/${bb}/${pp}${d ? '/' + d : ''}`);

  const allPockets = binder.pages.flat().filter((d) => d != null);
  const missingHere = allPockets.filter((d) => !entries[d]?.owned).length;
  const findPokemon = (text) => {
    const s = text.trim().toLowerCase().replace(/^#0*/, '');
    if (!s) return;
    const p = /^\d+$/.test(s) ? BY_DEX.get(+s) : POKEDEX.find((x) => x.name.toLowerCase().startsWith(s)) || POKEDEX.find((x) => x.name.toLowerCase().includes(s));
    if (!p) return;
    for (let bi = 0; bi < layout.length; bi++) {
      const pi = layout[bi].pages.findIndex((pg) => pg.includes(p.dex));
      if (pi >= 0) { goTo(bi, pi, p.dex); setQ(''); return; }
    }
  };
  const nextGap = () => {
    for (let bi = b; bi < layout.length; bi++) {
      const start = bi === b ? page + step : 0;
      for (let pi = start; pi < layout[bi].pages.length; pi++) {
        const d = layout[bi].pages[pi].find((x) => x != null && !entries[x]?.owned);
        if (d) { goTo(bi, pi, d); return; }
      }
    }
    toast({ msg: 'No more gaps after this page 🎉' });
  };

  return html`<div class="pad binder-view">
    <div class="row-wrap"><a class="icon-btn" href="#/" aria-label="Back"><${Icon} name="back" /></a><h1 class="grow">Binder view</h1></div>
    <div class="toolbar">
      ${layout.length > 1 && html`<select aria-label="Binder" value=${b} onChange=${(e) => goTo(+e.currentTarget.value, 0, 0)}>
        ${layout.map((x, i) => html`<option value=${i}>${x.name}</option>`)}</select>`}
      <input type="search" placeholder="Find a Pokémon…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)}
        onKeyDown=${(e) => e.key === 'Enter' && findPokemon(q)} />
      <button class="btn" onClick=${() => findPokemon(q)}>Find</button>
    </div>
    <p class="muted small">${binder.name}: ${binder.pages.length} pages · ${missingHere ? `${missingHere} gap${missingHere === 1 ? '' : 's'} to fill` : 'no gaps 🎉'}
      ${!binderSettings(settings).gaps && ' · cards are packed together, with no spaces left for missing Pokémon'}</p>

    <div class="page-nav">
      <button class="btn" disabled=${page === 0} onClick=${() => goTo(b, Math.max(0, page - step), 0)}>‹ Back</button>
      <select aria-label="Page" value=${page} onChange=${(e) => goTo(b, +e.currentTarget.value, 0)}>
        ${binder.pages.map((_, i) => (!wide || i % 2 === 0) && html`<option value=${i}>Page ${i + 1}${wide && i + 1 < binder.pages.length ? `–${i + 2}` : ''}</option>`)}
      </select>
      <button class="btn" disabled=${page + step >= binder.pages.length} onClick=${() => goTo(b, page + step, 0)}>Next ›</button>
      <button class="btn" onClick=${nextGap}>Next gap ›</button>
    </div>

    <div class=${`spread ${wide ? 'two' : ''}`}>
      <${BinderPage} binder=${binder} index=${page} entries=${entries} highlight=${hlDex} />
      ${wide && html`<${BinderPage} binder=${binder} index=${page + 1} entries=${entries} highlight=${hlDex} />`}
    </div>
    <p class="muted small">Tap a pocket to open that Pokémon. Faded pictures are Pokémon you haven't got yet.</p>
  </div>`;
}
