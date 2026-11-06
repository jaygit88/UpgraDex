import { html, render, useState, useEffect, useMemo, useRef, useLayoutEffect } from '../vendor/preact-htm.js';
import { loadStaticData, POKEDEX, BY_DEX, SETS, pad, spriteUrl, cardImg, GENS } from './data.js';
import { getCardsFor } from './api.js';
import { idbClear } from './idb.js';
import { PriceTag, PriceBlock } from './price.js';
import { rarityLabel, rarityRank, rarityShort, rarityTier, FANCY_MIN_RANK } from './rarity.js';
import * as store from './store.js';
import * as sync from './sync.js';

const { MAX_UPS, LANGS } = store;
const LANG_NAMES = { EN: 'English', JP: 'Japanese', KR: 'Korean' };

// ---------- Routing ----------

function parseRoute(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'p' && BY_DEX.has(+parts[1])) {
    const dex = +parts[1];
    if (parts[2] === 'cards') return { name: 'picker', dex, purpose: parts[3] || 'browse' };
    return { name: 'pokemon', dex };
  }
  if (parts[0] === 'shop') return { name: 'shop' };
  if (parts[0] === 'settings') return { name: 'settings' };
  return { name: 'dex' };
}

function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return parseRoute(hash);
}

const go = (path) => { location.hash = path; };

function useSessionState(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = sessionStorage.getItem('pu:' + key); return s != null ? JSON.parse(s) : initial; } catch { return initial; }
  });
  useEffect(() => { try { sessionStorage.setItem('pu:' + key, JSON.stringify(v)); } catch {} }, [v]);
  return [v, setV];
}

// ---------- Global sheet + toast ----------

let openSheet = () => {};
let toast = () => {};
const closeSheet = () => openSheet(null);

function speciesName(dex) {
  return BY_DEX.get(+dex)?.name || `#${dex}`;
}

// ---------- Small pieces ----------

function LangBadge({ lang }) {
  if (!lang) return null;
  return html`<span class=${`lang lang-${lang}`} title=${LANG_NAMES[lang]}>${lang}</span>`;
}

function LangPicker({ value, onChange }) {
  return html`<div class="lang-picker" role="group" aria-label="Card language">
    ${LANGS.map((l) => html`<button type="button" class=${`lang lang-${l} ${value === l ? 'on' : 'off'}`}
      aria-pressed=${value === l} onClick=${(e) => { e.stopPropagation(); onChange(l); }}>${l}</button>`)}
  </div>`;
}

function RarityChip({ rarity, short }) {
  if (!rarity || rarity === 'None') return null;
  const label = short ? rarityShort(rarity) || rarityLabel(rarity) : rarityLabel(rarity);
  return html`<span class=${`rarity r-${rarityTier(rarity)}`} title=${rarityLabel(rarity)}>${label}</span>`;
}

function CardImage({ card, q = 'low', className = '' }) {
  const [failed, setFailed] = useState(false);
  const src = card && !card.custom ? cardImg(card.img, q) : null;
  if (!src || failed) {
    return html`<div class=${`card-img placeholder ${className}`}>
      <div><b>${card?.name || '?'}</b><br/><span>${card?.set || ''}${card?.num ? ' · ' + card.num : ''}</span>
      ${card?.custom ? html`<br/><em>added by hand</em>` : !card?.img ? html`<br/><em>no picture yet</em>` : ''}</div>
    </div>`;
  }
  return html`<img class=${`card-img ${className}`} src=${src} alt=${`${card.name} – ${card.set}`} loading="lazy" decoding="async" onError=${() => setFailed(true)} />`;
}

function setLine(card) {
  const s = SETS[card.setId];
  const year = card.date && !card.date.startsWith('9999') ? card.date.slice(0, 4) : '';
  return [card.set || s?.n, card.num ? `#${card.num}` : '', year].filter(Boolean).join(' · ');
}

function Icon({ name }) {
  const paths = {
    dex: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 2a8 8 0 017.9 7h-4.1a4 4 0 00-7.6 0H4.1A8 8 0 0112 4zm0 6a2 2 0 110 4 2 2 0 010-4zm-7.9 3h4.1a4 4 0 007.6 0h4.1a8 8 0 01-15.8 0z',
    shop: 'M7 4h10l1 4h3v2h-1l-1.5 9a2 2 0 01-2 1.7H7.5a2 2 0 01-2-1.7L4 10H3V8h3l1-4zm1.6 2l-.5 2h7.8l-.5-2H8.6zM6 10l1.4 8h9.2L18 10H6z',
    settings: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.9 5.2l2-1.6-2-3.4-2.4.9a7 7 0 00-1.7-1L16.4 5h-4l-.4 2.6a7 7 0 00-1.7 1l-2.4-.9-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-.9a7 7 0 001.7 1l.4 2.6h4l.4-2.6a7 7 0 001.7-1l2.4.9 2-3.4-2-1.6a7 7 0 000-2z',
    back: 'M15.4 7.4L14 6l-6 6 6 6 1.4-1.4L10.8 12z',
    next: 'M8.6 16.6L10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
    up: 'M7.4 15.4L12 10.8l4.6 4.6L18 14l-6-6-6 6z',
    down: 'M7.4 8.6L12 13.2l4.6-4.6L18 10l-6 6-6-6z',
    close: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
    plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
    refresh: 'M17.6 6.4A8 8 0 1019.8 14h-2.1a6 6 0 11-1.4-6.2L13 11h7V4z',
  };
  return html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d=${paths[name]} /></svg>`;
}

// ---------- Actions ----------

function gotIt(dex, index) {
  const before = store.getEntry(dex);
  const up = before.ups[index];
  if (!up) return;
  store.updateEntry(dex, (e) => {
    const [u] = e.ups.splice(index, 1);
    e.owned = { ...u };
    delete e.owned.unknown;
    return e;
  });
  toast({ msg: `Nice! ${speciesName(dex)} upgraded 🎉`, undo: () => store.setEntry(dex, before) });
}

function removeUpgrade(dex, index) {
  const before = store.getEntry(dex);
  store.updateEntry(dex, (e) => { e.ups.splice(index, 1); return e; });
  toast({ msg: 'Removed from upgrades', undo: () => store.setEntry(dex, before) });
}

function moveUpgrade(dex, index, delta) {
  store.updateEntry(dex, (e) => {
    const j = index + delta;
    if (j < 0 || j >= e.ups.length) return e;
    [e.ups[index], e.ups[j]] = [e.ups[j], e.ups[index]];
    return e;
  });
}

function setLang(dex, where, lang) {
  store.updateEntry(dex, (e) => {
    if (where === 'owned' && e.owned) e.owned.lang = lang;
    else if (typeof where === 'number' && e.ups[where]) e.ups[where].lang = lang;
    return e;
  });
}

function nextDex(dex) {
  return dex >= POKEDEX.length ? 1 : dex + 1;
}

// ---------- Screens ----------

function Screen({ active, children }) {
  const ref = useRef(null);
  const pos = useRef(0);
  useLayoutEffect(() => {
    if (active && ref.current) ref.current.scrollTop = pos.current;
  }, [active]);
  return html`<main class="screen" ref=${ref} style=${active ? '' : 'display:none'}
    onScroll=${(e) => { if (active) pos.current = e.currentTarget.scrollTop; }}>${children}</main>`;
}

const DEX_FILTERS = [
  ['all', 'All'],
  ['missing', 'Missing'],
  ['unpicked', 'Card not picked'],
  ['noplan', 'No upgrades yet'],
  ['planned', 'Has upgrades'],
];

function matchesFilter(e, f) {
  switch (f) {
    case 'missing': return !e.owned;
    case 'unpicked': return !!(e.owned && e.owned.unknown);
    case 'noplan': return !!e.owned && !e.ups.length;
    case 'planned': return e.ups.length > 0;
    default: return true;
  }
}

function matchesSearch(p, q) {
  if (!q) return true;
  const s = q.trim().toLowerCase().replace(/^#0*/, '');
  if (/^\d+$/.test(s)) return String(p.dex) === s || String(p.dex).startsWith(s);
  return p.name.toLowerCase().includes(s) || (p.ja && p.ja.includes(q.trim())) || (p.ko && p.ko.includes(q.trim()));
}

function DexScreen() {
  const entries = store.useCollection();
  const [q, setQ] = useSessionState('dex.q', '');
  const [filter, setFilter] = useSessionState('dex.f', 'all');
  const [gen, setGen] = useSessionState('dex.g', 0);

  const stats = useMemo(() => {
    let owned = 0, planned = 0, ups = 0, unpicked = 0;
    for (const p of POKEDEX) {
      const e = entries[p.dex];
      if (!e) continue;
      if (e.owned) owned++;
      if (e.owned?.unknown) unpicked++;
      if (e.ups?.length) planned++;
      ups += e.ups?.length || 0;
    }
    return { owned, missing: POKEDEX.length - owned, planned, ups, unpicked };
  }, [entries]);

  const list = useMemo(() => POKEDEX.filter((p) =>
    (!gen || p.gen === gen) && matchesFilter(entries[p.dex] || store.EMPTY, filter) && matchesSearch(p, q)
  ), [entries, q, filter, gen]);

  const firstRun = stats.owned === 0 && stats.ups === 0;

  return html`<div class="pad">
    ${firstRun && html`<div class="callout">
      <b>Welcome!</b> Start by telling the app which Pokémon you already have.
      The quickest way: go to <a href="#/settings">Settings → Quick start</a> and type the numbers of the ~20 you're missing.
      Then pick the exact card for each Pokémon whenever you like.
    </div>`}
    <div class="stats">
      <div><b>${stats.owned}</b><span>of ${POKEDEX.length} owned</span></div>
      <div class="warn"><b>${stats.missing}</b><span>missing</span></div>
      <div><b>${stats.ups}</b><span>upgrades planned</span></div>
    </div>
    <div class="progress"><div style=${`width:${(stats.owned / POKEDEX.length) * 100}%`}></div></div>
    <div class="toolbar sticky">
      <input type="search" placeholder="Search name or number…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      <select value=${gen} onChange=${(e) => setGen(+e.currentTarget.value)} aria-label="Generation">
        <option value="0">All gens</option>
        ${GENS.map(([g, n]) => html`<option value=${g}>Gen ${g} · ${n}</option>`)}
      </select>
    </div>
    <div class="chips">
      ${DEX_FILTERS.map(([k, label]) => html`<button class=${`chip ${filter === k ? 'on' : ''}`} onClick=${() => setFilter(k)}>
        ${label}${k === 'missing' ? ` (${stats.missing})` : k === 'unpicked' && stats.unpicked ? ` (${stats.unpicked})` : ''}</button>`)}
    </div>
    ${list.length === 0 && html`<p class="muted center">Nothing matches.</p>`}
    <div class="dex-grid">
      ${list.map((p) => html`<${DexTile} key=${p.dex} p=${p} e=${entries[p.dex] || store.EMPTY} />`)}
    </div>
  </div>`;
}

function DexTile({ p, e }) {
  const owned = e.owned;
  const showCard = owned && !owned.unknown;
  return html`<a class=${`tile ${owned ? '' : 'missing'}`} href=${`#/p/${p.dex}`}>
    <div class="tile-img">
      ${showCard ? html`<${CardImage} card=${owned} />`
        : html`<img class="sprite" src=${spriteUrl(p.dex)} alt="" loading="lazy" />`}
    </div>
    <div class="tile-meta"><span class="num">${pad(p.dex)}</span><span class="name">${p.name}</span></div>
    <div class="tile-badges">
      ${!owned && html`<span class="badge missing-badge">Missing</span>`}
      ${owned?.unknown && html`<span class="badge">Pick card</span>`}
      ${showCard && owned.lang !== 'EN' && html`<${LangBadge} lang=${owned.lang} />`}
      ${e.ups.length > 0 && html`<span class="badge up-badge" title="Upgrades planned">⬆ ${e.ups.length}</span>`}
    </div>
  </a>`;
}

function PokemonScreen({ dex }) {
  store.useCollection();
  const p = BY_DEX.get(dex);
  const e = store.getEntry(dex);
  const [note, setNote] = useState(e.note || '');
  useEffect(() => setNote(store.getEntry(dex).note || ''), [dex]);
  const prev = dex <= 1 ? POKEDEX.length : dex - 1;

  const saveNote = () => {
    if (note !== (store.getEntry(dex).note || '')) store.updateEntry(dex, (x) => { x.note = note; return x; });
  };

  return html`<div class="pad narrow">
    <div class="poke-head">
      <a class="icon-btn" href=${`#/p/${prev}`} aria-label="Previous Pokémon"><${Icon} name="back" /></a>
      <img class="sprite big" src=${spriteUrl(dex)} alt="" />
      <div class="grow">
        <div class="muted">${pad(dex)} · Gen ${p.gen}</div>
        <h1>${p.name}</h1>
        <div class="muted small">${[p.ja, p.ko].filter(Boolean).join(' · ')}</div>
      </div>
      <a class="icon-btn" href=${`#/p/${nextDex(dex)}`} aria-label="Next Pokémon"><${Icon} name="next" /></a>
    </div>

    <h2>My card</h2>
    ${e.owned && !e.owned.unknown ? html`<div class="slot owned-slot">
        <button class="slot-img" onClick=${() => openSheet({ kind: 'slot', dex, where: 'owned' })}><${CardImage} card=${e.owned} /></button>
        <div class="slot-info">
          <div class="slot-name">${e.owned.name}</div>
          <div class="muted small">${setLine(e.owned)}</div>
          <div class="row-wrap"><${RarityChip} rarity=${e.owned.rarity} /></div>
          <${LangPicker} value=${e.owned.lang} onChange=${(l) => setLang(dex, 'owned', l)} />
          <div class="row-wrap">
            <a class="btn small" href=${`#/p/${dex}/cards/owned`}>Change</a>
          </div>
        </div>
      </div>`
    : e.owned?.unknown ? html`<div class="empty-slot">
        <p>You have a ${p.name} card, but haven't picked which one yet.</p>
        <div class="row-wrap">
          <a class="btn primary" href=${`#/p/${dex}/cards/owned`}>Pick my card</a>
          <button class="btn" onClick=${() => store.updateEntry(dex, (x) => { x.owned = null; return x; })}>Actually, it's missing</button>
        </div>
      </div>`
    : html`<div class="empty-slot missing">
        <p><b>Missing!</b> No ${p.name} in the collection yet. Any card will do — or add the ones you'd love below.</p>
        <div class="row-wrap">
          <a class="btn primary" href=${`#/p/${dex}/cards/owned`}>I've got one – pick it</a>
          <button class="btn" onClick=${() => store.updateEntry(dex, (x) => { x.owned = { unknown: true, lang: 'EN' }; return x; })}>Got one (pick later)</button>
        </div>
      </div>`}

    <h2>Upgrades <span class="muted">(${e.ups.length}/${MAX_UPS})</span></h2>
    ${e.ups.length === 0 && html`<p class="muted">No upgrades picked yet. Add up to ${MAX_UPS}, best first.</p>`}
    <ol class="ups">
      ${e.ups.map((u, i) => html`<li class="slot up-slot" key=${u.id + i}>
        <div class="rank">${i + 1}</div>
        <button class="slot-img" onClick=${() => openSheet({ kind: 'slot', dex, where: i })}><${CardImage} card=${u} /></button>
        <div class="slot-info">
          <div class="slot-name">${u.name}</div>
          <div class="muted small">${setLine(u)}</div>
          <div class="row-wrap"><${RarityChip} rarity=${u.rarity} /> ${!u.custom && html`<${PriceTag} id=${u.id} lang=${u.lang} />`}</div>
          <${LangPicker} value=${u.lang} onChange=${(l) => setLang(dex, i, l)} />
          <div class="row-wrap">
            <button class="btn small success" onClick=${() => gotIt(dex, i)}>Got it! 🎉</button>
            <button class="icon-btn small" disabled=${i === 0} onClick=${() => moveUpgrade(dex, i, -1)} aria-label="Move up"><${Icon} name="up" /></button>
            <button class="icon-btn small" disabled=${i === e.ups.length - 1} onClick=${() => moveUpgrade(dex, i, 1)} aria-label="Move down"><${Icon} name="down" /></button>
            <button class="icon-btn small" onClick=${() => removeUpgrade(dex, i)} aria-label="Remove"><${Icon} name="close" /></button>
          </div>
        </div>
      </li>`)}
    </ol>
    ${e.ups.length < MAX_UPS && html`<a class="btn primary block" href=${`#/p/${dex}/cards/up`}><${Icon} name="plus" /> Add an upgrade</a>`}

    <h2>Notes</h2>
    <textarea class="notes" rows="2" placeholder="e.g. Saw this at the card shop for £20" value=${note}
      onInput=${(ev) => setNote(ev.currentTarget.value)} onBlur=${saveNote}></textarea>

    <div class="row-wrap spaced">
      <a class="btn" href=${`#/p/${dex}/cards`}>Browse all ${p.name} cards</a>
      <a class="btn" href=${`#/p/${nextDex(dex)}`}>Next: ${speciesName(nextDex(dex))} <${Icon} name="next" /></a>
    </div>
  </div>`;
}

const SORTS = [['new', 'Newest'], ['old', 'Oldest'], ['rarity', 'Rarest']];

function PickerScreen({ dex, purpose }) {
  const entries = store.useCollection();
  const settings = store.useSettings();
  const p = BY_DEX.get(dex);
  const e = entries[dex] || store.EMPTY;
  const [state, setState] = useState({ loading: true, cards: [] });
  const [fancy, setFancy] = useSessionState('pick.fancy', false);
  const [rarity, setRarity] = useState('');
  const [text, setText] = useState('');
  const [sort, setSort] = useSessionState('pick.sort', 'new');

  const load = (force) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    getCardsFor(dex, p.name, { force }).then((r) => setState({ loading: false, ...r }));
  };
  useEffect(() => { setRarity(''); setText(''); load(false); }, [dex]);

  const rarities = useMemo(() => {
    const m = new Map();
    for (const c of state.cards) m.set(c.rarity, (m.get(c.rarity) || 0) + 1);
    return [...m.entries()].sort((a, b) => rarityRank(b[0]) - rarityRank(a[0]));
  }, [state.cards]);

  const shown = useMemo(() => {
    const t = text.trim().toLowerCase();
    let list = state.cards.filter((c) =>
      (!fancy || rarityRank(c.rarity) >= FANCY_MIN_RANK) && (!rarity || c.rarity === rarity) &&
      (!t || c.set.toLowerCase().includes(t) || c.name.toLowerCase().includes(t) || c.num.toLowerCase() === t || (SETS[c.setId]?.a || '').toLowerCase() === t));
    if (sort === 'old') list = [...list].reverse();
    if (sort === 'rarity') list = [...list].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.date.localeCompare(a.date));
    return list;
  }, [state.cards, fancy, rarity, text, sort]);

  const title = purpose === 'owned' ? `Which ${p.name} do you have?`
    : purpose === 'up' ? `Pick an upgrade for ${p.name}` : `${p.name} cards`;

  return html`<div class="pad">
    <div class="poke-head">
      <a class="icon-btn" href=${`#/p/${dex}`} aria-label="Back"><${Icon} name="back" /></a>
      <img class="sprite" src=${spriteUrl(dex)} alt="" />
      <div class="grow">
        <div class="muted small">${pad(dex)}</div>
        <h1 class="h-small">${title}</h1>
      </div>
      <button class="icon-btn" onClick=${() => load(true)} aria-label="Refresh card list"><${Icon} name="refresh" /></button>
    </div>
    ${purpose === 'owned' && html`<label class="check">
      <input type="checkbox" checked=${settings.fastSetup} onChange=${(ev) => store.updateSettings({ fastSetup: ev.currentTarget.checked })} />
      Fast setup: after picking, jump straight to the next Pokémon
    </label>`}
    <div class="toolbar">
      <input type="search" placeholder="Filter by set or number…" value=${text} onInput=${(ev) => setText(ev.currentTarget.value)} />
      <select value=${sort} onChange=${(ev) => setSort(ev.currentTarget.value)} aria-label="Sort">
        ${SORTS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
      </select>
    </div>
    <div class="chips">
      <button class=${`chip ${fancy ? 'on' : ''}`} onClick=${() => setFancy(!fancy)}>✨ Special only</button>
      <button class=${`chip ${!rarity ? 'on' : ''}`} onClick=${() => setRarity('')}>All rarities</button>
      ${rarities.map(([r, n]) => html`<button class=${`chip ${rarity === r ? 'on' : ''}`} onClick=${() => setRarity(rarity === r ? '' : r)}>
        ${rarityLabel(r)} <span class="muted">${n}</span></button>`)}
    </div>
    ${state.loading && state.cards.length === 0 && html`<p class="muted center">Loading cards…</p>`}
    ${state.error && html`<p class="error center">${state.error} <button class="btn small" onClick=${() => load(true)}>Try again</button></p>`}
    ${state.stale && html`<p class="muted center small">Offline – showing saved list.</p>`}
    ${!state.loading && !state.error && shown.length === 0 && html`<p class="muted center">No cards match.</p>`}
    <div class="card-grid">
      ${shown.map((c) => {
        const isOwned = store.sameCard(e.owned, c);
        const upIdx = e.ups.findIndex((u) => store.sameCard(u, c));
        return html`<button class=${`card-tile ${isOwned ? 'is-owned' : ''} ${upIdx >= 0 ? 'is-up' : ''}`} key=${c.id}
          onClick=${() => openSheet({ kind: 'pick', dex, card: c, purpose })}>
          <${CardImage} card=${c} />
          <div class="card-tile-meta">
            <span class="set-name">${c.set}</span>
            <span class="muted small">#${c.num}</span>
            <${RarityChip} rarity=${c.rarity} short />
          </div>
          ${isOwned && html`<span class="corner mine">Mine</span>`}
          ${upIdx >= 0 && html`<span class="corner up">⬆${upIdx + 1}</span>`}
        </button>`;
      })}
    </div>
    <p class="center spaced">
      <button class="btn" onClick=${() => openSheet({ kind: 'manual', dex, purpose })}>Can't find it? Add a card by hand</button>
    </p>
    <p class="muted small center">Japanese or Korean card? Pick the matching English card and set the language — or add it by hand if there's no English version.</p>
  </div>`;
}

function ShopScreen() {
  const entries = store.useCollection();
  const [q, setQ] = useSessionState('shop.q', '');
  const [topOnly, setTopOnly] = useSessionState('shop.top', false);
  const [sort, setSort] = useSessionState('shop.sort', 'dex');
  const [limit, setLimit] = useState(150);
  const [check, setCheck] = useState('');

  const rows = useMemo(() => {
    const out = [];
    const t = q.trim().toLowerCase();
    for (const p of POKEDEX) {
      const e = entries[p.dex];
      if (!e || !e.ups?.length) continue;
      e.ups.forEach((u, i) => {
        if (topOnly && i > 0) return;
        if (t && !(p.name.toLowerCase().includes(t) || u.name.toLowerCase().includes(t) || (u.set || '').toLowerCase().includes(t)
          || String(p.dex) === t.replace(/^#0*/, '') || (u.num || '').toLowerCase() === t)) return;
        out.push({ p, i, u });
      });
    }
    if (sort === 'set') out.sort((a, b) => (b.u.date || '').localeCompare(a.u.date || '') || (a.u.set || '').localeCompare(b.u.set || '') || (a.u.num || '').localeCompare(b.u.num || '', undefined, { numeric: true }));
    if (sort === 'rarity') out.sort((a, b) => rarityRank(b.u.rarity) - rarityRank(a.u.rarity) || a.p.dex - b.p.dex);
    return out;
  }, [entries, q, topOnly, sort]);

  const missing = useMemo(() => POKEDEX.filter((p) => !entries[p.dex]?.owned), [entries]);

  const suggestions = useMemo(() => {
    if (!check.trim()) return [];
    return POKEDEX.filter((p) => matchesSearch(p, check)).slice(0, 8);
  }, [check]);

  let lastSet = null;
  return html`<div class="pad narrow">
    <h1>Shop list</h1>
    <div class="price-check">
      <label class="small muted" for="pc">Price check any card</label>
      <input id="pc" type="search" placeholder="Type a Pokémon, e.g. Umbreon" value=${check} onInput=${(e) => setCheck(e.currentTarget.value)} />
      ${suggestions.length > 0 && html`<div class="suggest">
        ${suggestions.map((p) => html`<a href=${`#/p/${p.dex}/cards`} onClick=${() => setCheck('')}>
          <img class="sprite tiny" src=${spriteUrl(p.dex)} alt="" /> ${pad(p.dex)} ${p.name}</a>`)}
      </div>`}
    </div>

    ${missing.length > 0 && html`<details class="missing-box" open=${missing.length <= 40}>
      <summary><b>Still missing (${missing.length})</b> — any card will do</summary>
      <div class="chips">${missing.map((p) => html`<a class="chip" href=${`#/p/${p.dex}`}>${pad(p.dex)} ${p.name}</a>`)}</div>
    </details>`}

    <div class="toolbar sticky">
      <input type="search" placeholder="Search upgrades…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      <select value=${sort} onChange=${(e) => setSort(e.currentTarget.value)} aria-label="Sort">
        <option value="dex">Pokédex order</option>
        <option value="set">By set</option>
        <option value="rarity">Rarest first</option>
      </select>
    </div>
    <div class="chips">
      <button class=${`chip ${!topOnly ? 'on' : ''}`} onClick=${() => setTopOnly(false)}>All upgrades</button>
      <button class=${`chip ${topOnly ? 'on' : ''}`} onClick=${() => setTopOnly(true)}>Top pick only</button>
    </div>
    ${rows.length === 0 && html`<p class="muted center">No upgrades planned yet. Open a Pokémon and tap “Add an upgrade”.</p>`}
    <div class="shop-list">
      ${rows.slice(0, limit).map(({ p, i, u }) => {
        const header = sort === 'set' && u.set !== lastSet ? html`<div class="group-head">${u.set || 'Unknown set'}</div>` : null;
        lastSet = u.set;
        return html`${header}<button class="shop-row" key=${p.dex + '-' + i} onClick=${() => openSheet({ kind: 'slot', dex: p.dex, where: i })}>
          <${CardImage} card=${u} className="thumb" />
          <div class="grow">
            <div><span class="muted">${pad(p.dex)}</span> <b>${p.name}</b> <span class="badge up-badge">⬆${i + 1}</span></div>
            <div class="small">${u.name}</div>
            <div class="muted small">${setLine(u)}</div>
            <div class="row-wrap"><${RarityChip} rarity=${u.rarity} /><${LangBadge} lang=${u.lang} /></div>
          </div>
          ${!u.custom && html`<${PriceTag} id=${u.id} lang=${u.lang} />`}
        </button>`;
      })}
    </div>
    ${rows.length > limit && html`<p class="center"><button class="btn" onClick=${() => setLimit(limit + 150)}>Show more (${rows.length - limit} left)</button></p>`}
    <p class="muted small center">Prices are typical recent sale prices for the English card, refreshed daily. Shops usually charge a bit more than this — but not loads more!</p>
  </div>`;
}

function SyncStatusDot() {
  const [s, setS] = useState(sync.getSyncStatus());
  useEffect(() => sync.onSyncStatus(setS), []);
  if (s.state === 'off') return null;
  return html`<a class=${`sync-dot s-${s.state}`} href="#/settings" title=${s.message}>${s.state === 'on' ? '☁︎' : s.state === 'error' ? '⚠︎' : '…'}</a>`;
}

const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{family}/entries/{dex} {
      allow read, write: if family.size() >= 20;
    }
  }
}`;

function SyncGuide() {
  return html`<details>
    <summary><b>How to set up Firebase</b> (free, grown-up job)</summary>
    <ol class="small guide">
      <li>Go to <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a>, sign in with a Google account and click <i>Create a project</i> (name it e.g. “dex-upgrades”; Google Analytics can be turned off).</li>
      <li>In the left menu choose <i>Build → Firestore Database → Create database</i>. Pick a location near you and start in <i>production mode</i>.</li>
      <li>Open the <i>Rules</i> tab, replace everything with the rules below and click <i>Publish</i>.
        <pre>${RULES}</pre>
        <button class="btn small" onClick=${() => navigator.clipboard?.writeText(RULES).then(() => toast({ msg: 'Rules copied' }))}>Copy rules</button></li>
      <li>Click the ⚙️ next to <i>Project overview → Project settings</i>. Under <i>Your apps</i> click the <b>&lt;/&gt;</b> (Web) button, give it a nickname and click <i>Register app</i> (no hosting needed).</li>
      <li>Copy the <code>firebaseConfig = { … }</code> block it shows and paste it in the box below on the <b>tablet</b>.</li>
      <li>Then use <i>Share / copy join link</i> and open that link on each phone.</li>
    </ol>
    <p class="muted small">The free plan is far more than a family needs. The config isn't a password; the long random “family code” in the join link is what keeps your collection private.</p>
  </details>`;
}

function SettingsScreen() {
  const settings = store.useSettings();
  const entries = store.useCollection();
  const [syncStatus, setSyncStatus] = useState(sync.getSyncStatus());
  useEffect(() => sync.onSyncStatus(setSyncStatus), []);
  const [cfgText, setCfgText] = useState('');
  const [joinText, setJoinText] = useState('');
  const [missingText, setMissingText] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const connectNew = async () => {
    setErr('');
    try {
      const cfg = sync.parseFirebaseConfig(cfgText);
      await sync.enableSync(cfg, sync.newFamilyCode());
      setCfgText('');
    } catch (e) { setErr(e.message); }
  };

  const joinPasted = async () => {
    setErr('');
    const m = joinText.match(/#join=([A-Za-z0-9_-]+)/);
    const saved = location.hash;
    if (m) {
      history.replaceState(null, '', '#join=' + m[1]);
      const j = sync.readJoinFromHash();
      history.replaceState(null, '', saved || '#/settings');
      if (j) { await sync.enableSync(j.config, j.code); setJoinText(''); return; }
    }
    setErr("That doesn't look like a join link.");
  };

  const shareLink = async () => {
    const link = sync.joinLink(settings.sync);
    if (navigator.share) {
      try { await navigator.share({ title: 'Dex Upgrades', text: 'Open this to see the Pokémon collection on this device', url: link }); return; } catch {}
    }
    try { await navigator.clipboard.writeText(link); toast({ msg: 'Link copied – send it to the other device' }); }
    catch { prompt('Copy this link and open it on the other device:', link); }
  };

  const applyMissing = () => {
    const missingSet = store.parseNumberList(missingText);
    if (!confirm(`Mark all ${POKEDEX.length - missingSet.size} other Pokémon as "owned" (you can pick the exact cards later)? Pokémon you've already set up won't change.`)) return;
    let n = 0;
    for (const p of POKEDEX) {
      const e = store.getEntry(p.dex);
      if (missingSet.has(p.dex)) continue;
      if (e.owned) continue;
      store.updateEntry(p.dex, (x) => { x.owned = { unknown: true, lang: 'EN' }; return x; });
      n++;
    }
    toast({ msg: `Marked ${n} Pokémon as owned` });
    setMissingText('');
  };

  const exportFile = async () => {
    const text = store.exportJSON();
    const name = `dex-upgrades-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch {}
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importFile = async (ev) => {
    const f = ev.currentTarget.files[0];
    ev.currentTarget.value = '';
    if (!f) return;
    try {
      const imported = store.parseImport(await f.text());
      if (!confirm(`Replace everything on this device with the backup (${Object.keys(imported).length} Pokémon)?`)) return;
      store.replaceAll(imported);
      toast({ msg: 'Backup restored' });
    } catch (e) { alert(e.message); }
  };

  const count = Object.values(entries).filter((e) => e.owned).length;

  return html`<div class="pad narrow settings">
    <h1>Settings</h1>

    <section>
      <h2>Quick start</h2>
      <p>Already have most of the Pokédex? Type the numbers of the Pokémon you're <b>missing</b> (e.g. <code>132, 201, 487-489</code>).
        Everything else is marked as owned and you can pick the exact cards later.</p>
      <textarea rows="2" placeholder="Missing numbers…" value=${missingText} onInput=${(e) => setMissingText(e.currentTarget.value)}></textarea>
      <button class="btn primary" disabled=${!missingText.trim()} onClick=${applyMissing}>Mark the rest as owned</button>
      <p class="muted small">Currently ${count} of ${POKEDEX.length} marked as owned.</p>
    </section>

    <section>
      <h2>Prices</h2>
      <label>Main price to show
        <select value=${settings.priceSource} onChange=${(e) => store.updateSettings({ priceSource: e.currentTarget.value })}>
          <option value="cardmarket">Cardmarket 30-day average (Europe / UK)</option>
          <option value="tcgplayer">TCGplayer market price (USA)</option>
        </select>
      </label>
      <label>Show prices in
        <select value=${settings.currency} onChange=${(e) => store.updateSettings({ currency: e.currentTarget.value })}>
          <option value="native">Original currency (€ / $)</option>
          <option value="GBP">£ British pounds (converted)</option>
          <option value="EUR">€ Euros (converted)</option>
          <option value="USD">$ US dollars (converted)</option>
          <option value="AUD">$ Australian dollars (converted)</option>
          <option value="CAD">$ Canadian dollars (converted)</option>
          <option value="NZD">$ New Zealand dollars (converted)</option>
        </select>
      </label>
      <label>Default language for new cards
        <select value=${settings.defaultLang} onChange=${(e) => store.updateSettings({ defaultLang: e.currentTarget.value })}>
          ${LANGS.map((l) => html`<option value=${l}>${LANG_NAMES[l]}</option>`)}
        </select>
      </label>
    </section>

    <section>
      <h2>Share between devices</h2>
      ${settings.sync ? html`
        <p>Status: <b class=${`s-${syncStatus.state}`}>${syncStatus.message || syncStatus.state}</b></p>
        <p>To add another phone or tablet, send it this link and open it there:</p>
        <div class="row-wrap">
          <button class="btn primary" onClick=${shareLink}>Share / copy join link</button>
          <button class="btn" onClick=${() => sync.restartSync()}>Reconnect</button>
          <button class="btn danger" onClick=${() => { if (confirm('Stop syncing on this device? The collection stays on this device.')) sync.disableSync(); }}>Disconnect this device</button>
        </div>
        <p class="muted small">Anyone with the link can see and edit the collection, so only share it with family.</p>`
      : html`
        <p>Right now the collection is saved on <b>this device only</b>. To see it on the tablet and phones, connect a free Firebase project (one-time, ~10 minutes).</p>
        <${SyncGuide} />
        <details>
          <summary><b>First device:</b> paste your Firebase config</summary>
          <textarea rows="6" placeholder="const firebaseConfig = { apiKey: ..., projectId: ... }" value=${cfgText} onInput=${(e) => setCfgText(e.currentTarget.value)}></textarea>
          <button class="btn primary" disabled=${!cfgText.trim()} onClick=${connectNew}>Connect &amp; upload this collection</button>
        </details>
        <details>
          <summary><b>Other devices:</b> paste a join link</summary>
          <textarea rows="3" placeholder="https://…#join=…" value=${joinText} onInput=${(e) => setJoinText(e.currentTarget.value)}></textarea>
          <button class="btn primary" disabled=${!joinText.trim()} onClick=${joinPasted}>Join</button>
        </details>`}
      ${(err || syncStatus.state === 'error') && html`<p class="error">${err || syncStatus.message}</p>`}
    </section>

    <section>
      <h2>Backup</h2>
      <p>Save a copy of the whole collection as a file, just in case.</p>
      <div class="row-wrap">
        <button class="btn" onClick=${exportFile}>Save backup file</button>
        <button class="btn" onClick=${() => fileRef.current.click()}>Restore from backup…</button>
        <input type="file" accept=".json,application/json" ref=${fileRef} style="display:none" onChange=${importFile} />
      </div>
    </section>

    <section>
      <h2>Install on a tablet or phone</h2>
      <ul class="small">
        <li><b>iPad / iPhone (Safari):</b> tap Share <span aria-hidden="true">⎋</span> → <i>Add to Home Screen</i>.</li>
        <li><b>Android (Chrome):</b> tap ⋮ → <i>Add to Home screen</i> / <i>Install app</i>.</li>
      </ul>
      <p class="muted small">Installing keeps the data safe — Safari can clear saved data for websites you haven't opened in a while, but not for installed apps.</p>
    </section>

    <section>
      <h2>Card data</h2>
      <button class="btn" onClick=${async () => { await idbClear(); toast({ msg: 'Saved card lists and prices cleared' }); }}>Clear saved card lists &amp; prices</button>
      <p class="muted small">Card info, pictures and prices come from <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (prices from Cardmarket and TCGplayer). Pokédex from PokéAPI.
        Not affiliated with Nintendo, The Pokémon Company or Creatures.</p>
    </section>
  </div>`;
}

// ---------- Sheets ----------

function Sheet({ sheet }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  // Close the sheet when navigating.
  useEffect(() => {
    const f = () => closeSheet();
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  let body = null;
  if (sheet.kind === 'pick') body = html`<${PickSheet} ...${sheet} />`;
  if (sheet.kind === 'slot') body = html`<${SlotSheet} ...${sheet} />`;
  if (sheet.kind === 'manual') body = html`<${ManualSheet} ...${sheet} />`;
  return html`<div class="sheet-backdrop" onClick=${closeSheet}>
    <div class="sheet" role="dialog" aria-modal="true" onClick=${(e) => e.stopPropagation()}>
      <button class="icon-btn sheet-close" onClick=${closeSheet} aria-label="Close"><${Icon} name="close" /></button>
      ${body}
    </div>
  </div>`;
}

function CardDetails({ card }) {
  const s = SETS[card.setId];
  return html`<div class="card-details">
    <h2>${card.name}</h2>
    <div>${card.set}${s?.a ? ` (${s.a})` : ''}</div>
    <div class="muted small">${[card.num ? `Card #${card.num}` : '', card.date && !card.date.startsWith('9999') ? `Released ${card.date}` : '', s?.sn].filter(Boolean).join(' · ')}</div>
    <div class="row-wrap"><${RarityChip} rarity=${card.rarity} /></div>
  </div>`;
}

function PickSheet({ dex, card, purpose }) {
  store.useCollection();
  const settings = store.useSettings();
  const e = store.getEntry(dex);
  const [lang, setLang] = useState(settings.defaultLang || 'EN');
  const isOwned = store.sameCard(e.owned, card);
  const upIdx = e.ups.findIndex((u) => store.sameCard(u, card));
  const full = e.ups.length >= MAX_UPS;

  const setOwned = () => {
    const before = store.getEntry(dex);
    store.updateEntry(dex, (x) => {
      x.owned = store.slotFromCard(card, lang);
      x.ups = x.ups.filter((u) => !store.sameCard(u, card));
      return x;
    });
    toast({ msg: `Saved as your ${speciesName(dex)}`, undo: () => store.setEntry(dex, before) });
    if (purpose === 'owned' && settings.fastSetup) go(`#/p/${nextDex(dex)}/cards/owned`);
    else go(`#/p/${dex}`);
  };

  const addUp = () => {
    store.updateEntry(dex, (x) => { x.ups.push(store.slotFromCard(card, lang)); return x; });
    toast({ msg: `Added as upgrade #${e.ups.length + 1}` });
    go(`#/p/${dex}`);
  };

  const primaryOwned = purpose === 'owned';
  const ownedBtn = html`<button class=${`btn ${primaryOwned ? 'primary' : ''}`} disabled=${isOwned} onClick=${setOwned}>${isOwned ? 'This is your card' : 'This is my card'}</button>`;
  const upBtn = html`<button class=${`btn ${!primaryOwned ? 'primary' : ''}`} disabled=${full || upIdx >= 0 || isOwned} onClick=${addUp}>
    ${upIdx >= 0 ? `Already upgrade #${upIdx + 1}` : full ? `Upgrade list full (${MAX_UPS})` : `Add as upgrade #${e.ups.length + 1}`}</button>`;

  return html`<div class="sheet-body">
    <div class="sheet-img"><${CardImage} card=${card} q="high" /></div>
    <div class="sheet-info">
      <${CardDetails} card=${card} />
      <div class="field"><span class="small muted">Language of the card</span><${LangPicker} value=${lang} onChange=${setLang} /></div>
      <div class="row-wrap actions">${primaryOwned ? [ownedBtn, upBtn] : [upBtn, ownedBtn]}</div>
      <${PriceBlock} id=${card.id} lang=${lang} name=${card.name} query=${`${card.name} ${card.num} ${card.set}`} />
    </div>
  </div>`;
}

function SlotSheet({ dex, where }) {
  store.useCollection();
  const e = store.getEntry(dex);
  const card = where === 'owned' ? e.owned : e.ups[where];
  if (!card || card.unknown) return html`<p class="pad">This card has been changed.</p>`;
  return html`<div class="sheet-body">
    <div class="sheet-img"><${CardImage} card=${card} q="high" /></div>
    <div class="sheet-info">
      <div class="muted">${pad(dex)} ${speciesName(dex)} · ${where === 'owned' ? 'My card' : `Upgrade #${where + 1}`}</div>
      <${CardDetails} card=${card} />
      <div class="field"><span class="small muted">Language</span><${LangPicker} value=${card.lang} onChange=${(l) => setLang(dex, where, l)} /></div>
      <div class="row-wrap actions">
        ${where === 'owned'
          ? html`<a class="btn" href=${`#/p/${dex}/cards/owned`}>Change card</a>`
          : html`<button class="btn success" onClick=${() => { gotIt(dex, where); closeSheet(); }}>Got it! 🎉</button>
                 <button class="btn" onClick=${() => { removeUpgrade(dex, where); closeSheet(); }}>Remove</button>`}
        <a class="btn" href=${`#/p/${dex}`}>Open ${speciesName(dex)}</a>
      </div>
      ${!card.custom && html`<${PriceBlock} id=${card.id} lang=${card.lang} name=${card.name} query=${`${card.name} ${card.num} ${card.set}`} />`}
    </div>
  </div>`;
}

const RARITY_OPTIONS = ['Common', 'Uncommon', 'Rare', 'Holo Rare', 'Double rare', 'Ultra Rare', 'Illustration rare',
  'Special illustration rare', 'Hyper rare', 'Secret Rare', 'Shiny rare', 'Promo', 'Art Rare (AR)', 'Super Rare (SR)', 'Special Art Rare (SAR)', 'Ultra Rare (UR)', 'Other'];

function ManualSheet({ dex, purpose }) {
  const settings = store.useSettings();
  const e = store.getEntry(dex);
  const [f, setF] = useState({ name: speciesName(dex), set: '', num: '', rarity: '', lang: settings.defaultLang === 'EN' ? 'JP' : settings.defaultLang });
  const upd = (k) => (ev) => setF({ ...f, [k]: ev.currentTarget.value });
  const full = e.ups.length >= MAX_UPS;

  const save = (asOwned) => {
    const slot = { id: 'custom-' + Date.now().toString(36), name: f.name.trim() || speciesName(dex), img: '', rarity: f.rarity, set: f.set.trim(), setId: '', num: f.num.trim(), date: '', lang: f.lang, custom: true };
    store.updateEntry(dex, (x) => { if (asOwned) x.owned = slot; else x.ups.push(slot); return x; });
    closeSheet();
    go(`#/p/${dex}`);
  };

  return html`<div class="sheet-body single">
    <h2>Add a card by hand</h2>
    <p class="muted small">For cards that aren't in the list — e.g. Japanese- or Korean-only cards.</p>
    <label>Card name <input value=${f.name} onInput=${upd('name')} /></label>
    <label>Set <input value=${f.set} onInput=${upd('set')} placeholder="e.g. Terastal Festival ex" /></label>
    <label>Card number <input value=${f.num} onInput=${upd('num')} placeholder="e.g. 211/187" /></label>
    <label>Rarity
      <select value=${f.rarity} onChange=${upd('rarity')}>
        <option value="">—</option>
        ${RARITY_OPTIONS.map((r) => html`<option value=${r}>${rarityLabel(r)}</option>`)}
      </select>
    </label>
    <div class="field"><span class="small muted">Language</span><${LangPicker} value=${f.lang} onChange=${(l) => setF({ ...f, lang: l })} /></div>
    <div class="row-wrap actions">
      <button class=${`btn ${purpose === 'owned' ? 'primary' : ''}`} onClick=${() => save(true)}>This is my card</button>
      <button class=${`btn ${purpose !== 'owned' ? 'primary' : ''}`} disabled=${full} onClick=${() => save(false)}>${full ? 'Upgrade list full' : 'Add as upgrade'}</button>
    </div>
  </div>`;
}

// ---------- App shell ----------

function Toast({ t, onDone }) {
  useEffect(() => {
    const id = setTimeout(onDone, t.undo ? 6000 : 3000);
    return () => clearTimeout(id);
  }, [t]);
  return html`<div class="toast" role="status">
    <span>${t.msg}</span>
    ${t.undo && html`<button class="btn small" onClick=${() => { t.undo(); onDone(); }}>Undo</button>`}
  </div>`;
}

function App() {
  const route = useRoute();
  const [sheet, setSheet] = useState(null);
  const [t, setT] = useState(null);
  openSheet = setSheet;
  toast = (x) => setT({ ...x, key: Date.now() });

  const tab = route.name === 'shop' ? 'shop' : route.name === 'settings' ? 'settings' : 'dex';
  return html`<div class="app">
    <header class="top">
      <a class="brand" href="#/"><span class="ball" aria-hidden="true"></span>Dex Upgrades</a>
      <${SyncStatusDot} />
    </header>
    <div class="screens">
      <${Screen} active=${route.name === 'dex'}><${DexScreen} /></${Screen}>
      ${route.name === 'pokemon' && html`<${Screen} active key=${'p' + route.dex}><${PokemonScreen} dex=${route.dex} /></${Screen}>`}
      ${route.name === 'picker' && html`<${Screen} active key=${'c' + route.dex + route.purpose}><${PickerScreen} dex=${route.dex} purpose=${route.purpose} /></${Screen}>`}
      ${route.name === 'shop' && html`<${Screen} active><${ShopScreen} /></${Screen}>`}
      ${route.name === 'settings' && html`<${Screen} active><${SettingsScreen} /></${Screen}>`}
    </div>
    <nav class="tabs">
      <a class=${tab === 'dex' ? 'on' : ''} href="#/"><${Icon} name="dex" /><span>Pokédex</span></a>
      <a class=${tab === 'shop' ? 'on' : ''} href="#/shop"><${Icon} name="shop" /><span>Shop list</span></a>
      <a class=${tab === 'settings' ? 'on' : ''} href="#/settings"><${Icon} name="settings" /><span>Settings</span></a>
    </nav>
    ${sheet && html`<${Sheet} sheet=${sheet} />`}
    ${t && html`<${Toast} key=${t.key} t=${t} onDone=${() => setT(null)} />`}
  </div>`;
}

async function main() {
  try {
    await loadStaticData();
  } catch (e) {
    document.getElementById('app').innerHTML = '<p style="padding:2rem">Could not load the app data. Check your connection and reload.</p>';
    return;
  }

  const join = sync.readJoinFromHash();
  if (join) {
    history.replaceState(null, '', '#/');
    const already = store.getSettings().sync;
    const same = already && already.code === join.code;
    if (same || confirm('Join the shared Pokémon collection on this device? Anything already on this device will be merged in.')) {
      sync.enableSync(join.config, join.code);
    }
  }

  render(html`<${App} />`, document.getElementById('app'));
  sync.startSync();

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
