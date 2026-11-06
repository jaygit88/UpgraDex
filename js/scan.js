// Scan tab: photograph cards and let the scanner (a small Cloudflare Worker that asks Claude)
// read them, then match what it read to the exact card in the TCGdex list.
//   Quick scan  – one card, Claude Haiku 5.5: what is it, what's it worth, add it.
//   Catalogue   – a binder page of up to 9 cards, Claude Sonnet 5.5: save them all as "my card".

import { html, useState, useRef, useMemo } from '../vendor/preact-htm.js';
import { POKEDEX, BY_DEX, SETS, pad } from './data.js';
import { getCardsFor } from './api.js';
import { PriceBlock } from './price.js';
import * as store from './store.js';
import { IS_TEST } from './env.js';
import { SCANNER_SUBDOMAIN } from './config.js';
import { openSheet, toast, CardImage, LangPicker, LangBadge, RarityChip, CardDetails, setLine, Icon, speciesName } from './app.js';

// ---------- Talking to the scanner ----------

export function scannerUrl(settings) {
  if (settings.scannerUrl) return settings.scannerUrl.trim().replace(/\/+$/, '');
  if (!SCANNER_SUBDOMAIN) return '';
  return `https://upgradex-scanner${IS_TEST ? '-test' : ''}.${SCANNER_SUBDOMAIN}.workers.dev`;
}

const MAX_EDGE = { quick: 1568, catalog: 2576 };

// Shrink the photo before sending: smaller uploads, lower cost, still sharp enough to read.
async function shrink(file, maxEdge) {
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

async function callScanner(settings, body) {
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
export const normNum = (s) => String(s || '').toUpperCase().replace(/\s/g, '').replace(/^([A-Z]*)0+(\d)/, '$1$2');

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

export function rankCards(det, cards) {
  const num = normNum(det.number);
  const code = norm(det.set_code);
  const name = norm(det.card_name);
  const scored = cards.map((c, i) => {
    let s = 0;
    if (num && normNum(c.num) === num) s += 4;
    if (code && norm(SETS[c.setId]?.a) === code) s += 3;
    if (name && norm(c.name) === name) s += 1;
    return { c, s, i };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i); // ties keep newest-first order
  const top = scored[0];
  const numberMatches = scored.filter((x) => x.s >= 4).length;
  // Sure = set code and number both match, or (English card) only one card has that number and the name matches.
  const sure = !!top && (top.s >= 7 || (det.language === 'EN' && numberMatches === 1 && top.s >= 5));
  return { best: top && top.s >= 4 ? top.c : null, candidates: scored.map((x) => x.c), sure };
}

async function matchDetection(det) {
  const p = findPokemon(det);
  if (!p) return { det, p: null, best: null, candidates: [], sure: false };
  const { cards, error } = await getCardsFor(p.dex, p.name);
  return { det, p, loadError: cards.length ? null : error || `No ${p.name} cards found in the card database.`, ...rankCards(det, cards) };
}

const langOf = (det) => (['EN', 'JP', 'KR'].includes(det.language) ? det.language : 'EN');

function readLine(det) {
  const num = det.number ? `#${det.number}${det.set_total ? '/' + det.set_total : ''}` : '';
  return [det.card_name || det.pokemon || '?', det.set_code, num, det.language].filter(Boolean).join(' · ');
}

// ---------- Screen ----------

export function ScanScreen() {
  const settings = store.useSettings();
  const ready = !!(scannerUrl(settings) && settings.scannerPass);
  const [state, setState] = useState({ phase: 'idle' });
  const inputs = { quick: useRef(null), catalog: useRef(null), quickGallery: useRef(null), catalogGallery: useRef(null) };

  const run = async (mode, file) => {
    if (!file) return;
    setState({ phase: 'working', mode });
    try {
      const img = await shrink(file, MAX_EDGE[mode]);
      const res = await callScanner(settings, { mode, image: img.base64 });
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
        <h2>Catalogue a binder page</h2>
        <p class="muted small">Photograph a whole page (up to 9 cards) and save them all as his cards. Uses the more careful reader.</p>
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

    ${state.phase === 'quick' && html`<${QuickResult} key=${state.key} matches=${state.matches} preview=${state.preview}
      onAgain=${() => pick('quick')} onDone=${() => setState({ phase: 'idle' })} />`}

    ${state.phase === 'catalog' && html`<${CatalogResult} key=${state.key} matches=${state.matches} preview=${state.preview}
      onAgain=${() => pick('catalog')} onDone=${() => setState({ phase: 'idle' })} />`}
  </div>`;
}

function statusLine(dex, card) {
  const e = store.getEntry(dex);
  if (e.owned && store.sameCard(e.owned, card)) return html`<span class="badge ok-badge">✓ This is his card</span>`;
  const up = e.ups.findIndex((u) => store.sameCard(u, card));
  if (up >= 0) return html`<span class="badge up-badge">⬆ Upgrade #${up + 1} on his list</span>`;
  if (!e.owned) return html`<span class="badge missing-badge">He's missing ${speciesName(dex)}!</span>`;
  return null;
}

function Candidates({ m, chosen, onChoose }) {
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
  const [showAll, setShowAll] = useState(!m?.best);
  const retry = async () => {
    const again = await matchDetection(m.det);
    setM(again);
    setChosen(again.best || null);
    setShowAll(!again.best);
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

    ${m.p && chosen && html`<div class="sheet-body">
      <div class="sheet-img"><${CardImage} card=${chosen} q="high" /></div>
      <div class="sheet-info">
        <div class="muted">${pad(m.p.dex)} ${m.p.name}</div>
        <${CardDetails} card=${chosen} />
        <div class="row-wrap">
          ${m.sure && chosen === m.best ? html`<span class="badge ok-badge">✓ Matched</span>` : html`<span class="badge">Best guess – check it's the same picture</span>`}
          <${LangBadge} lang=${lang} />
          ${statusLine(m.p.dex, chosen)}
        </div>
        <div class="row-wrap actions">
          <button class="btn primary" onClick=${() => openSheet({ kind: 'pick', dex: m.p.dex, card: chosen, purpose: 'up', lang })}>Add or save…</button>
          <button class="btn" onClick=${onAgain}><${Icon} name="camera" /> Scan another</button>
        </div>
        <${PriceBlock} id=${chosen.id} lang=${lang} name=${chosen.name} query=${`${chosen.name} ${chosen.num} ${chosen.set}`} />
      </div>
    </div>`}

    ${m.p && m.loadError && html`<${LoadProblem} m=${m} onRetry=${retry} />`}

    ${m.p && !m.loadError && !chosen && html`<p>Couldn't find the exact card — pick it below.</p>`}

    ${m.p && !m.loadError && html`<details class="cand-box" open=${showAll} onToggle=${(e) => setShowAll(e.currentTarget.open)}>
      <summary><b>Not the right card?</b> Choose from ${m.candidates.length} ${m.p.name} cards</summary>
      <${Candidates} m=${m} chosen=${chosen} onChoose=${(c) => { setChosen(c); setShowAll(false); }} />
      <p class="small"><a href=${`#/p/${m.p.dex}/cards`}>Open the full ${m.p.name} card list</a></p>
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
    return { m, chosen: m.best, lang, action: m.p ? defaultAction(m.p.dex, m.best, lang) : 'skip', open: false };
  }));
  const update = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toSave = rows.filter((r) => r.m.p && ((r.action === 'save' && r.chosen) || r.action === 'mark'));

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
    toast({ msg: `Saved ${n} card${n === 1 ? '' : 's'} 🎉`, undo: () => { for (const [dex, e] of before) store.setEntry(dex, e); } });
    setRows((rs) => rs.map((r) => (r.action === 'save' ? { ...r, action: 'have' } : r.action === 'mark' ? { ...r, action: 'marked' } : r)));
  };

  return html`<div class="scan-result">
    <div class="read-line"><img class="scan-preview" src=${preview} alt="Your photo" /><div>
      <b>Found ${matches.length} card${matches.length === 1 ? '' : 's'}</b>
      <div class="muted small">Check each one, then save. Tap a card to pick a different version.</div>
    </div></div>

    ${matches.length === 0 && html`<p>No cards found. Try again with the whole page in the photo and less glare.</p>`}

    <div class="cat-list">
      ${rows.map((r, i) => {
        const { m } = r;
        const owned = m.p && store.getEntry(m.p.dex).owned;
        const differs = owned && !owned.unknown && r.chosen && !store.sameCard(owned, r.chosen);
        return html`<div class=${`cat-row ${['save', 'mark'].includes(r.action) ? 'will-save' : ''}`} key=${i}>
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
                ${r.chosen && (m.sure && r.chosen === m.best ? html`<span class="badge ok-badge">✓ Matched</span>` : html`<span class="badge">Check this one</span>`)}
                ${r.chosen && html`<${RarityChip} rarity=${r.chosen.rarity} short />`}
              </div>
              <${LangPicker} value=${r.lang} onChange=${(l) => update(i, { lang: l, action: r.action === 'have' ? 'save' : r.action })} />
              ${m.p && !r.chosen && (r.action === 'marked'
                ? html`<div class="small ok-text">✓ Marked as owned – pick the exact card later</div>`
                : !store.getEntry(m.p.dex).owned && html`<label class="check small">
                    <input type="checkbox" checked=${r.action === 'mark'} onChange=${(e) => update(i, { action: e.currentTarget.checked ? 'mark' : 'skip' })} />
                    He's got a ${m.p.name} now (pick the exact card later)
                  </label>`)}
              ${m.p && r.chosen && (r.action === 'have'
                ? html`<div class="small ok-text">✓ Saved as his ${m.p.name}</div>`
                : html`<label class="check small">
                    <input type="checkbox" checked=${r.action === 'save'} onChange=${(e) => update(i, { action: e.currentTarget.checked ? 'save' : 'skip' })} />
                    ${differs ? `Replace his current ${m.p.name} (${owned.set} #${owned.num})` : `Save as his ${m.p.name}`}
                  </label>`)}
            </div>
          </div>
          ${r.open && m.p && html`<${Candidates} m=${m} chosen=${r.chosen} onChoose=${(c) => update(i, { chosen: c, open: false, action: defaultAction(m.p.dex, c, r.lang) === 'have' ? 'have' : 'save' })} />`}
        </div>`;
      })}
    </div>

    <div class="row-wrap spaced sticky-actions">
      <button class="btn primary" disabled=${!toSave.length} onClick=${save}>Save ${toSave.length} card${toSave.length === 1 ? '' : 's'}</button>
      <button class="btn" onClick=${onAgain}><${Icon} name="camera" /> Scan next page</button>
      <button class="btn" onClick=${onDone}>Done</button>
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
