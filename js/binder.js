// Binder map: where each Pokémon's card goes, given the binders he keeps the collection in.
// Cards go in National Pokédex order across the binders, one pocket each.

import { html, useState } from '../vendor/preact-htm.js';
import { POKEDEX } from './data.js';
import * as store from './store.js';

const POCKET_LAYOUTS = { 4: [2, 2], 9: [3, 3], 12: [3, 4], 16: [4, 4], 18: [3, 3] }; // [columns, rows] per page side

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
      const [cols] = POCKET_LAYOUTS[pockets] || [Math.ceil(Math.sqrt(pockets))];
      const row = Math.floor((pocket - 1) / cols) + 1;
      const col = ((pocket - 1) % cols) + 1;
      return { binder: b + 1, name: name || `Binder ${b + 1}`, page, pocket, row, col, cols, rows: Math.ceil(pockets / cols) };
    }
    index -= capacity;
  }
  return { full: true };
}

function where(s) {
  const rowWord = s.row === 1 ? 'top row' : s.row === s.rows ? 'bottom row' : s.rows === 3 ? 'middle row' : `row ${s.row}`;
  const colWord = s.cols === 3 ? ['left', 'middle', 'right'][s.col - 1] : s.cols === 2 ? ['left', 'right'][s.col - 1] : `${s.col}${['st', 'nd', 'rd'][s.col - 1] || 'th'} from left`;
  return rowWord === 'middle row' && colWord === 'middle' ? 'right in the middle' : `${rowWord}, ${colWord}`;
}

// "📒 Binder 1 · page 11 · pocket 4 (middle left)" — shown on a Pokémon's page and when saving cards.
export function BinderSpot({ dex, compact = false }) {
  const settings = store.useSettings();
  store.useCollection();
  const s = binderSpot(dex, settings);
  if (!s) return null;
  if (s.full) return html`<div class="binder-spot small">📒 Not enough room in the binders set up in Settings</div>`;
  return html`<div class=${`binder-spot ${compact ? 'small' : ''}`}>
    📒 <b>${s.name}</b> · page ${s.page} · pocket ${s.pocket} <span class="muted">(${where(s)})</span>
  </div>`;
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
        <select value=${b.pockets} onChange=${(e) => save(list.map((x, j) => (j === i ? { ...x, pockets: +e.currentTarget.value } : x)))}>
          ${[4, 9, 12, 16].map((n) => html`<option value=${n}>${n}</option>`)}
        </select></label>
      <button class="icon-btn small" aria-label="Remove binder" onClick=${() => save(list.filter((_, j) => j !== i))}>✕</button>
    </div>`)}
    <div class="row-wrap">
      <button class="btn" onClick=${() => save([...list, { name: '', pages: 40, pockets: 9 }])}>+ Add a binder</button>
    </div>
    <label class="check"><input type="checkbox" checked=${gaps} onChange=${(e) => save(list, e.currentTarget.checked)} />
      Leave an empty pocket for each missing Pokémon</label>
    ${list.length > 0 && html`<p class=${`small ${capacity < need ? 'error' : 'muted'}`}>
      Room for ${capacity} cards — ${need} needed${capacity < need ? '. Add pages or another binder.' : '.'}</p>`}
    <p class="muted small">Binder setup is saved on this device.</p>
  </section>`;
}
