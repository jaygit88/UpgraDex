// Scan tab: photograph cards and let the scanner (a small Cloudflare Worker that asks Claude)
// read them, then match what it read to the exact card in the TCGdex list.
//   Quick scan  – one card, Claude Haiku 5.5: what is it, what's it worth, add it.
//   Catalogue   – a binder page of up to 16 cards, Claude Sonnet 5.5: save them all as "my card".

import { html, useState, useRef, useMemo } from '../vendor/preact-htm.js';
import { POKEDEX, BY_DEX, SETS, pad, CAT_FOR_LANG, intlCardsFor } from './data.js';
import { getCardsFor, priceKey } from './api.js';
import { PriceBlock } from './price.js';
import * as store from './store.js';
import { IS_TEST } from './env.js';
import { SCANNER_SUBDOMAIN } from './config.js';
import { openSheet, toast, CardImage, LangPicker, LangBadge, RarityChip, CardDetails, setLine, Icon, speciesName } from './app.js';
import { VerdictBanner } from './verdict.js';
import { BinderSpot } from './binder.js';
import { TradeCheck } from './trade.js';

// ---------- Talking to the scanner ----------

export function scannerUrl(settings) {
  if (settings.scannerUrl) return settings.scannerUrl.trim().replace(/\/+$/, '');
  if (!SCANNER_SUBDOMAIN) return '';
  return `https://upgradex-scanner${IS_TEST ? '-test' : ''}.${SCANNER_SUBDOMAIN}.workers.dev`;
}

export const MAX_EDGE = { quick: 1568, catalog: 2576 };

// Cards per page from the first binder in Settings → Binders (tells the scanner the grid layout).
function binderPockets(settings) {
  const b = Array.isArray(settings.binders) && settings.binders.find((x) => x && x.pockets);
  return b ? b.pockets : null;
}

// Shrink the photo before sending: smaller uploads, lower cost, still sharp enough to read.
export async function shrink(file, maxEdge) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
  return { base64: String(dataUrl).split(',')[1], preview: URL.createObjectURL(blob) };
}

export async function callScanner(settings, body) {
  const url = scannerUrl(settings);
  let r;
  try {
    r = await fetch(`${url}/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Passcode': settings.scannerPass || '' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the scanner – are you online?");
  }
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) {
    const err = new Error(j.error || `Scanner error (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return j;
}

// ---------- Matching what was read to a real card ----------

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// "001" -> "1", "TG012" -> "TG12", "swsh203" -> "SWSH203"
// "001" -> "1", "TG012" -> "TG12", "#057/091" -> "57", "No. 25" -> "25"
export const normNum = (s) => String(s || '').toUpperCase().split('/')[0]
  .replace(/^NO\.?/, '').replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]*)0+(\d)/, '$1$2');
const normTotal = (s) => String(s || '').replace(/\D/g, '').replace(/^0+(\d)/, '$1');

export function findPokemon(det) {
  if (det.pokemon) {
    const byName = POKEDEX.find((p) => norm(p.name) === norm(det.pokemon));
    if (byName) return byName;
  }
  if (det.dex_number && BY_DEX.has(det.dex_number)) return BY_DEX.get(det.dex_number);
  const cn = norm(det.card_name);
  if (!cn) return null;
  return POKEDEX.filter((p) => cn.includes(norm(p.name))).sort((a, b) => b.name.length - a.name.length)[0] || null;
}

// Ranks a Pokémon's cards against what the scanner read. Points:
//   number matches 4 · set code matches 3 · set's official total matches the "/189" part 2 · exact name 1
// Older cards print no set code, so the total after the slash is what tells the sets apart.
// Result: best (pre-selected card), level ('exact' | 'likely' | 'guess'), sure (exact), candidates (ranked).
export function rankCards(det, cards) {
  const num = normNum(det.number);
  const code = norm(det.set_code);
  const total = normTotal(det.set_total || (String(det.number || '').split('/')[1] || ''));
  const name = norm(det.card_name);
  const scored = cards.map((c, i) => {
    const set = SETS[c.setId];
    const numHit = !!num && normNum(c.num) === num;
    const codeHit = !!code && norm(c.code || set?.a) === code; // Japanese cards: the set id is the printed code (e.g. SV8a)
    const totalHit = !!total && String(c.total || set?.o || '') === total;
    let s = 0;
    if (numHit) s += 4;
    if (codeHit) s += 3;
    if (totalHit) s += 2;
    if (name && norm(c.name) === name) s += 1;
    return { c, s, i, numHit, setHit: codeHit || totalHit };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i); // ties keep newest-first order
  const top = scored[0];
  if (!top) return { best: null, level: null, sure: false, candidates: [] };
  const tied = scored.filter((x) => x.s === top.s).length;
  let level = 'guess';
  if (top.numHit && top.setHit && tied === 1) level = 'exact';
  else if (top.numHit && tied === 1) level = 'likely';
  else if (top.numHit || (top.setHit && tied === 1)) level = 'likely';
  return { best: top.c, level, sure: level === 'exact', candidates: scored.map((x) => x.c) };
}

export async function matchDetection(det) {
  const p = findPokemon(det);
  if (!p) return { det, p: null, best: null, candidates: [], sure: false };
  // A Japanese (or Korean) card is matched against that language's cards first: they're different printings
  // with their own set codes and numbers (e.g. Terastal Festival sv8a 217/187), and their own prices.
  const cat = CAT_FOR_LANG[det.language];
  if (cat) {
    try {
      const intl = await intlCardsFor(cat, p.dex);
      if (intl.length) return { det, p, cat, loadError: null, ...rankCards(det, intl) };
    } catch {}
  }
  const { cards, error } = await getCardsFor(p.dex, p.name);
  return { det, p, cat: '', loadError: cards.length ? null : error || `No ${p.name} cards found in the card database.`, ...rankCards(det, cards) };
}

export const langOf = (det) => (['EN', 'JP', 'KR'].includes(det.language) ? det.language : 'EN');

function readLine(det) {
  const num = det.number ? `#${det.number}${det.set_total ? '/' + det.set_total : ''}` : '';
  return [det.card_name || det.pokemon || '?', det.set_code, num, det.language].filter(Boolean).join(' · ');
}

// ---------- Screen ----------

export function ScanScreen() {
  const settings = store.useSettings();
  const ready = !!(scannerUrl(settings) && settings.scannerPass);
  const pocketsLabel = binderPockets(settings) || 16;
  const [state, setState] = useState({ phase: 'idle' });
  const inputs = { quick: useRef(null), catalog: useRef(null), quickGallery: useRef(null), catalogGallery: useRef(null) };

  const run = async (mode, file) => {
    if (!file) return;
    setState({ phase: 'working', mode });
    try {
      const img = await shrink(file, MAX_EDGE[mode]);
      const res = await callScanner(settings, { mode, image: img.base64, pockets: binderPockets(settings) });
      const matches = await Promise.all((res.cards || []).map(matchDetection));
      setState({ phase: mode, preview: img.preview, matches, key: Date.now() });
    } catch (e) {
      setState({ phase: 'error', mode, message: e.message || String(e) });
    }
  };

  const pick = (mode, gallery = false) => inputs[gallery ? `${mode}Gallery` : mode].current.click();
  const fileInput = (mode, gallery) => html`<input type="file" accept="image/*" capture=${gallery ? undefined : 'environment'} hidden
    ref=${inputs[gallery ? `${mode}Gallery` : mode]}
    onChange=${(e) => { const f = e.currentTarget.files[0]; e.currentTarget.value = ''; run(mode, f); }} />`;

  return html`<div class="pad narrow">
    <h1>Scan</h1>
    ${fileInput('quick', false)}${fileInput('quick', true)}${fileInput('catalog', false)}${fileInput('catalog', true)}

    ${!ready && html`<div class="callout">
      <b>The scanner isn't set up yet.</b> It needs a small one-off setup by a grown-up — see <a href="#/settings">Settings → Scanner</a>.
    </div>`}

    ${(state.phase === 'idle' || state.phase === 'error') && html`<div class="scan-modes">
      <section class="scan-mode">
        <h2>Quick scan</h2>
        <p class="muted small">One card — find out what it is and what it's worth. Great in a shop.</p>
        <div class="row-wrap">
          <button class="btn primary" disabled=${!ready} onClick=${() => pick('quick')}><${Icon} name="camera" /> Scan a card</button>
          <button class="btn" disabled=${!ready} onClick=${() => pick('quick', true)}>Choose photo</button>
        </div>
      </section>
      <section class="scan-mode">
        <h2>Trade check</h2>
        <p class="muted small">Swapping with a friend? Add both sides' cards to see if it's a fair trade — and whether their cards are upgrades for you.</p>
        <div class="row-wrap">
          <button class="btn primary" onClick=${() => setState({ phase: 'trade' })}>Check a trade</button>
        </div>
      </section>
      <section class="scan-mode">
        <h2>Catalogue a binder page</h2>
        <p class="muted small">Photograph a whole binder page (up to ${pocketsLabel} cards) and save them all as your cards — or add them to your swaps. Uses the more careful reader.</p>
        <div class="row-wrap">
          <button class="btn primary" disabled=${!ready} onClick=${() => pick('catalog')}><${Icon} name="camera" /> Scan a page</button>
          <button class="btn" disabled=${!ready} onClick=${() => pick('catalog', true)}>Choose photo</button>
        </div>
      </section>
    </div>
    <p class="muted small">Tips: good light, hold the phone flat above the card(s), and tilt slightly if shiny cards reflect the light.</p>`}

    ${state.phase === 'error' && html`<p class="error">${state.message}</p>`}

    ${state.phase === 'working' && html`<div class="scan-working">
      <img class="scan-gif" src="icons/loading-charmander.gif" alt="" width="348" height="231" />
      <p>${state.mode === 'quick' ? 'Reading the card…' : 'Reading the page… this takes a few seconds'}</p>
    </div>`}

    ${state.phase === 'trade' && html`<${TradeCheck} ready=${ready} onDone=${() => setState({ phase: 'idle' })} />`}

    ${state.phase === 'quick' && html`<${QuickResult} key=${state.key} matches=${state.matches} preview=${state.preview}
      onAgain=${() => pick('quick')} onDone=${() => setState({ phase: 'idle' })} />`}

    ${state.phase === 'catalog' && html`<${CatalogResult} key=${state.key} matches=${state.matches} preview=${state.preview}
      onAgain=${() => pick('catalog')} onDone=${() => setState({ phase: 'idle' })} />`}
  </div>`;
}

// How sure the scanner is about the pre-selected card.
function MatchBadge({ m, chosen }) {
  if (chosen !== m.best) return html`<span class="badge">You picked this one</span>`;
  if (m.level === 'exact') return html`<span class="badge ok-badge">✓ Matched</span>`;
  if (m.level === 'likely') return html`<span class="badge likely-badge">Probably this one – check the picture</span>`;
  return html`<span class="badge guess-badge">Best guess – check it's the same picture</span>`;
}

export function Candidates({ m, chosen, onChoose }) {
  const list = m.candidates.slice(0, 24);
  if (!list.length) return null;
  return html`<div class="cand-strip" role="list">
    ${list.map((c) => html`<button role="listitem" class=${`cand ${chosen && chosen.id === c.id ? 'on' : ''}`} onClick=${() => onChoose(c)} title=${`${c.set} #${c.num}`}>
      <${CardImage} card=${c} />
      <span class="small">${c.set}<br />#${c.num}</span>
    </button>`)}
  </div>`;
}

function LoadProblem({ m, onRetry }) {
  const [busy, setBusy] = useState(false);
  return html`<div class="callout">
    <b>${m.loadError}</b>
    <div class="row-wrap">
      <button class="btn primary" disabled=${busy} onClick=${async () => { setBusy(true); await onRetry(); setBusy(false); }}>${busy ? 'Trying…' : 'Try again'}</button>
      <a class="btn" href=${`#/p/${m.p.dex}/cards`}>Browse all ${m.p.name} cards</a>
    </div>
  </div>`;
}

function QuickResult({ matches, preview, onAgain, onDone }) {
  store.useCollection();
  const [m, setM] = useState(matches[0]);
  const [chosen, setChosen] = useState(m?.best || null);
  const [showAll, setShowAll] = useState(!m?.best || m?.level === 'guess');
  const retry = async () => {
    const again = await matchDetection(m.det);
    setM(again);
    setChosen(again.best || null);
    setShowAll(!again.best || again.level === 'guess');
  };

  if (!m) {
    return html`<div class="scan-result">
      <p>No card found in that photo. Try again with the card filling more of the picture.</p>
      <div class="row-wrap"><button class="btn primary" onClick=${onAgain}>Try again</button><button class="btn" onClick=${onDone}>Back</button></div>
    </div>`;
  }
  const lang = langOf(m.det);
  return html`<div class="scan-result">
    <div class="read-line"><img class="scan-preview" src=${preview} alt="Your photo" /><div>
      <div class="muted small">The scanner read:</div><b>${readLine(m.det)}</b>
    </div></div>

    ${!m.p && html`<p class="error">Couldn't tell which Pokémon this is. Try a clearer photo.</p>`}

    ${m.p && chosen && html`<${VerdictBanner} dex=${m.p.dex} card=${chosen} lang=${lang} />
      <${BinderSpot} dex=${m.p.dex} compact />`}

    ${m.p && chosen && html`<div class="sheet-body">
      <div class="sheet-img"><${CardImage} card=${chosen} q="high" /></div>
      <div class="sheet-info">
        <div class="muted">${pad(m.p.dex)} ${m.p.name}</div>
        <${CardDetails} card=${chosen} />
        <div class="row-wrap">
          <${MatchBadge} m=${m} chosen=${chosen} />
          <${LangBadge} lang=${lang} />
        </div>

        <div class="row-wrap actions">
          <button class="btn primary" onClick=${() => openSheet({ kind: 'pick', dex: m.p.dex, card: chosen, purpose: 'up', lang })}>Add or save…</button>
          <button class="btn" onClick=${onAgain}><${Icon} name="camera" /> Scan another</button>
        </div>
        <${PriceBlock} id=${priceKey(chosen)} cat=${chosen.cat} lang=${lang} name=${chosen.name} query=${`${chosen.name} ${chosen.num} ${chosen.set}`} />
      </div>
    </div>`}

    ${m.p && m.loadError && html`<${LoadProblem} m=${m} onRetry=${retry} />`}

    ${m.p && !m.loadError && !chosen && html`<p>Couldn't find the exact card — pick it below.</p>`}

    ${m.p && !m.loadError && html`<details class="cand-box" open=${showAll} onToggle=${(e) => setShowAll(e.currentTarget.open)}>
      <summary><b>Not the right card?</b> Choose from ${m.candidates.length} ${m.cat === 'ja' ? 'Japanese ' : m.cat === 'ko' ? 'Korean ' : ''}${m.p.name} cards</summary>
      <${Candidates} m=${m} chosen=${chosen} onChoose=${(c) => { setChosen(c); setShowAll(false); }} />
      <p class="small"><a href=${`#/p/${m.p.dex}/cards/browse${m.cat ? '/' + m.cat : ''}`}>Open the full ${m.p.name} card list</a></p>
    </details>`}

    <p><button class="btn" onClick=${onDone}>Done</button></p>
  </div>`;
}

function defaultAction(dex, card, lang) {
  const e = store.getEntry(dex);
  if (!card) return e.owned ? 'skip' : 'mark'; // no exact match: at least record that he has one now
  if (!e.owned || e.owned.unknown) return 'save';
  if (store.sameCard(e.owned, card) && e.owned.lang === lang) return 'have';
  return 'skip'; // he already has a different card saved for this Pokémon
}

function CatalogResult({ matches, preview, onAgain, onDone }) {
  store.useCollection();
  const [rows, setRows] = useState(() => matches.map((m) => {
    const lang = langOf(m.det);
    let action = m.p ? defaultAction(m.p.dex, m.best, lang) : 'skip';
    if (m.level === 'guess' && action === 'save') action = 'skip'; // only save a guess if he ticks it
    return { m, chosen: m.best, lang, action, open: false, swap: !!m.best && m.level !== 'guess' };
  }));
  const update = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toSave = rows.filter((r) => r.m.p && ((r.action === 'save' && r.chosen) || r.action === 'mark'));
  const [savedCount, setSavedCount] = useState(0); // cards saved from this page so far
  const [leaving, setLeaving] = useState(null); // 'done' | 'next' while asking about unsaved cards
  // Is this page his collection, or a page of spare cards to add to his swaps?
  const [target, setTarget] = useState('collection');
  const swapsMode = target === 'swaps';
  const toSwap = rows.filter((r) => r.m.p && r.chosen && r.swap && !r.swapped);
  const pending = swapsMode ? toSwap : toSave;

  // What's on the page, for the summary line.
  const counts = { save: toSave.length, have: 0, check: 0, replace: 0 };
  for (const r of rows) {
    if (r.action === 'have' || r.action === 'marked') counts.have++;
    else if (!r.m.p || (!r.chosen && r.action !== 'mark') || (r.m.level === 'guess' && r.action === 'skip' && r.chosen === r.m.best)) counts.check++;
    else if (r.action === 'skip' && r.chosen) counts.replace++;
  }
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

  // Leaving with unsaved ticked cards? Ask first instead of quietly losing them.
  const leave = (kind) => {
    if (pending.length) { setLeaving(kind); return; }
    (kind === 'next' ? onAgain : onDone)();
  };

  const save = () => {
    const before = new Map();
    for (const r of toSave) {
      const dex = r.m.p.dex;
      if (!before.has(dex)) before.set(dex, store.getEntry(dex));
      store.updateEntry(dex, (x) => {
        if (r.action === 'mark') {
          if (!x.owned) x.owned = { unknown: true, lang: r.lang };
          return x;
        }
        x.owned = store.slotFromCard(r.chosen, r.lang);
        x.ups = x.ups.filter((u) => !store.sameCard(u, r.chosen));
        return x;
      });
    }
    const n = toSave.length;
    toast({ msg: `Saved ${n} card${n === 1 ? '' : 's'} to your collection 🎉`, undo: () => { for (const [dex, e] of before) store.setEntry(dex, e); setSavedCount((c) => c - n); } });
    setRows((rs) => rs.map((r) => (r.action === 'save' ? { ...r, action: 'have', justSaved: true } : r.action === 'mark' ? { ...r, action: 'marked' } : r)));
    setSavedCount((c) => c + n);
    return n;
  };

  const saveSwaps = () => {
    const before = new Map();
    for (const r of toSwap) {
      const dex = r.m.p.dex;
      if (!before.has(dex)) before.set(dex, store.getEntry(dex));
      store.addSwap(dex, r.chosen, r.lang, 1);
    }
    const n = toSwap.length;
    toast({ msg: `Added ${n} card${n === 1 ? '' : 's'} to your swaps 🔁`, undo: () => { for (const [dex, e] of before) store.setEntry(dex, e); setSavedCount((c) => c - n); } });
    setRows((rs) => rs.map((r) => (r.swap && r.chosen && r.m.p && !r.swapped ? { ...r, swapped: true } : r)));
    setSavedCount((c) => c + n);
    return n;
  };
  const doSave = () => (swapsMode ? saveSwaps() : save());

  return html`<div class="scan-result">
    <div class="read-line"><img class="scan-preview" src=${preview} alt="Your photo" /><div>
      <b>Found ${matches.length} card${matches.length === 1 ? '' : 's'}</b>
      <div class="muted small">Check each one, then press <b>Save</b>. Tap a card to pick a different version.</div>
    </div></div>

    ${matches.length > 0 && savedCount === 0 && html`<div class="seg" role="tablist" aria-label="What are these cards?">
      <button role="tab" aria-selected=${!swapsMode} class=${!swapsMode ? 'on' : ''} onClick=${() => setTarget('collection')}>📒 My collection</button>
      <button role="tab" aria-selected=${swapsMode} class=${swapsMode ? 'on' : ''} onClick=${() => setTarget('swaps')}>🔁 These are swaps</button>
    </div>`}

    ${matches.length > 0 && swapsMode && html`<div class="cat-summary" role="status">
      ${toSwap.length > 0 && html`<span class="sum-chip sum-save">🔁 ${plural(toSwap.length, 'card')} to add to swaps</span>`}
      ${rows.filter((r) => r.swapped).length > 0 && html`<span class="sum-chip sum-have">${plural(rows.filter((r) => r.swapped).length, 'card')} added</span>`}
      ${rows.filter((r) => !r.swapped && (!r.chosen || !r.swap)).length > 0 && html`<span class="sum-chip sum-check">${plural(rows.filter((r) => !r.swapped && (!r.chosen || !r.swap)).length, 'card needs', 'cards need')} checking</span>`}
    </div>`}

    ${matches.length > 0 && !swapsMode && html`<div class="cat-summary" role="status">
      ${counts.save > 0 && html`<span class="sum-chip sum-save">✓ ${plural(counts.save, 'card')} to save</span>`}
      ${counts.have > 0 && html`<span class="sum-chip sum-have">${plural(counts.have, 'card')} already yours</span>`}
      ${counts.replace > 0 && html`<span class="sum-chip sum-replace">${plural(counts.replace, 'card')} you already have a different version of (tick to replace)</span>`}
      ${counts.check > 0 && html`<span class="sum-chip sum-check">${plural(counts.check, 'card needs', 'cards need')} checking</span>`}
    </div>`}

    ${savedCount > 0 && pending.length === 0 && html`<div class="saved-banner" role="status">
      <b>✓ ${plural(savedCount, 'card')} ${swapsMode ? 'added to your swaps' : 'saved to your collection'}</b>
      <div class="row-wrap">
        <a class="btn" href=${swapsMode ? '#/swaps' : '#/'}>${swapsMode ? 'View swaps' : 'View in Pokédex'}</a>
        <button class="btn primary" onClick=${onAgain}><${Icon} name="camera" /> Scan next page</button>
      </div>
    </div>`}

    ${matches.length === 0 && html`<p>No cards found. Try again with the whole page in the photo and less glare.</p>`}

    <div class="cat-list">
      ${rows.map((r, i) => {
        const { m } = r;
        const owned = m.p && store.getEntry(m.p.dex).owned;
        const differs = owned && !owned.unknown && r.chosen && !store.sameCard(owned, r.chosen);
        return html`<div class=${`cat-row ${(swapsMode ? r.swap && r.chosen && !r.swapped : ['save', 'mark'].includes(r.action)) ? 'will-save' : ''}`} key=${i}>
          <div class="cat-main">
            <button class="cat-img" onClick=${() => update(i, { open: !r.open })} aria-label="Choose a different card">
              ${r.chosen ? html`<${CardImage} card=${r.chosen} />` : html`<div class="card-img placeholder"><div>?</div></div>`}
            </button>
            <div class="grow">
              <div>${m.p ? html`<span class="muted">${pad(m.p.dex)}</span> <b>${m.p.name}</b>` : html`<b>Unknown card</b>`}</div>
              <div class="small">${r.chosen ? setLine(r.chosen) : m.loadError ? html`<span class="error">${m.loadError}</span>` : 'Not matched – tap the picture to choose'}</div>
              ${m.p && m.loadError && html`<button class="btn small" onClick=${async () => {
                const again = await matchDetection(m.det);
                update(i, { m: again, chosen: again.best, action: defaultAction(again.p.dex, again.best, r.lang) });
              }}>Try again</button>`}
              <div class="muted small">Read: ${readLine(m.det)}</div>
              <div class="row-wrap">
                ${r.chosen && html`<${MatchBadge} m=${m} chosen=${r.chosen} />`}
                ${r.chosen && html`<${RarityChip} rarity=${r.chosen.rarity} short />`}
              </div>
              ${m.p && html`<${BinderSpot} dex=${m.p.dex} compact />`}
              <${LangPicker} value=${r.lang} onChange=${(l) => update(i, { lang: l, action: r.action === 'have' ? 'save' : r.action })} />
              ${swapsMode && m.p && r.chosen && (r.swapped
                ? html`<div class="small ok-text">✓ Added to your swaps</div>`
                : html`<label class="check small">
                    <input type="checkbox" checked=${r.swap} onChange=${(e) => update(i, { swap: e.currentTarget.checked })} />
                    ${m.level === 'guess' && r.chosen === m.best && !r.swap ? 'Best guess — tick if it\'s the right card' : 'Add to my swaps'}
                  </label>`)}
              ${!swapsMode && m.p && !r.chosen && (r.action === 'marked'
                ? html`<div class="small ok-text">✓ Marked as owned – pick the exact card later</div>`
                : !store.getEntry(m.p.dex).owned && html`<label class="check small">
                    <input type="checkbox" checked=${r.action === 'mark'} onChange=${(e) => update(i, { action: e.currentTarget.checked ? 'mark' : 'skip' })} />
                    I've got a ${m.p.name} now (pick the exact card later)
                  </label>`)}
              ${!swapsMode && m.p && r.chosen && (r.action === 'have'
                ? html`<div class="small ok-text">${r.justSaved ? `✓ Saved as your ${m.p.name}` : `✓ Already your ${m.p.name} — nothing to save`}</div>`
                : html`<label class="check small">
                    <input type="checkbox" checked=${r.action === 'save'} onChange=${(e) => update(i, { action: e.currentTarget.checked ? 'save' : 'skip' })} />
                    ${differs ? `Replace your current ${m.p.name} (${owned.set} #${owned.num})` : m.level === 'guess' && r.chosen === m.best && r.action !== 'save' ? `Best guess — tick if it's the right card` : `Save as your ${m.p.name}`}
                  </label>`)}
            </div>
          </div>
          ${r.open && m.p && html`<${Candidates} m=${m} chosen=${r.chosen} onChoose=${(c) => update(i, { chosen: c, open: false, swap: true, action: defaultAction(m.p.dex, c, r.lang) === 'have' ? 'have' : 'save' })} />`}
        </div>`;
      })}
    </div>

    <div class="sticky-actions">
      ${leaving && html`<div class="leave-warning" role="alertdialog" aria-label="Unsaved cards">
        <b>Wait — you haven't ${swapsMode ? 'added' : 'saved'} ${plural(pending.length, 'card')} yet!</b>
        <div class="row-wrap">
          <button class="btn primary" onClick=${() => { doSave(); const kind = leaving; setLeaving(null); (kind === 'next' ? onAgain : onDone)(); }}>
            ${swapsMode ? 'Add' : 'Save'} ${plural(pending.length, 'card')}${leaving === 'next' ? ' & scan next' : ''}</button>
          <button class="btn" onClick=${() => { const kind = leaving; setLeaving(null); (kind === 'next' ? onAgain : onDone)(); }}>Leave without saving</button>
          <button class="btn small" onClick=${() => setLeaving(null)}>Go back</button>
        </div>
      </div>`}
      ${!leaving && html`<div class="row-wrap">
        ${pending.length > 0
          ? html`<button class="btn primary big-save" onClick=${doSave}>${swapsMode ? `🔁 Add ${plural(pending.length, 'card')} to swaps` : `💾 Save ${plural(pending.length, 'card')}`}</button>`
          : html`<button class="btn primary" disabled>Nothing new to ${swapsMode ? 'add' : 'save'}</button>`}
        <button class="btn" onClick=${() => leave('next')}><${Icon} name="camera" /> Scan next page</button>
        <button class="btn" onClick=${() => leave('done')}>Done</button>
      </div>`}
    </div>
  </div>`;
}

// ---------- Settings section ----------

export function ScannerSettings() {
  const settings = store.useSettings();
  const [url, setUrl] = useState(settings.scannerUrl || '');
  const [pass, setPass] = useState(settings.scannerPass || '');
  const [check, setCheck] = useState('');
  const effective = scannerUrl({ ...settings, scannerUrl: url });

  const saveAndCheck = async () => {
    store.updateSettings({ scannerUrl: url.trim(), scannerPass: pass.trim() });
    setCheck('Checking…');
    try {
      // A request with no photo: a wrong passcode gives 401, a right one gives 400 ("missing photo").
      await callScanner({ ...settings, scannerUrl: url.trim(), scannerPass: pass.trim() }, { mode: 'check' });
      setCheck('✓ Connected');
    } catch (e) {
      setCheck(e.status === 400 ? '✓ Connected — scanner ready' : `✗ ${e.message}`);
    }
  };

  return html`<section>
    <h2>Scanner</h2>
    <p class="small">Card scanning uses a small server you set up once (Cloudflare + an Anthropic account — see <code>SCANNER.md</code> in the repo).
      Quick scans cost a tiny fraction of a penny; cataloguing about 2p per binder page.</p>
    <label>Scanner address
      <input value=${url} placeholder=${effective || 'https://upgradex-scanner….workers.dev'} onInput=${(e) => setUrl(e.currentTarget.value)} />
    </label>
    <label>Scanner passcode
      <input type="password" value=${pass} autocomplete="off" onInput=${(e) => setPass(e.currentTarget.value)} />
    </label>
    <div class="row-wrap">
      <button class="btn primary" disabled=${!(url.trim() || effective) || !pass.trim()} onClick=${saveAndCheck}>Save & check</button>
      ${check && html`<span class=${check.startsWith('✓') ? 'ok-text' : 'error'}>${check}</span>`}
    </div>
    ${!url && effective && html`<p class="muted small">Leave the address empty to use ${effective}.</p>`}
  </section>`;
}
