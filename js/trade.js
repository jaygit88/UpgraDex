// Trade check: put his cards on one side and his friend's on the other, see both values and
// whether it's a fair swap. Each of the friend's cards also says if it's an upgrade for him.

import { html, useState, useRef, useMemo } from '../vendor/preact-htm.js';
import { POKEDEX, pad, spriteUrl } from './data.js';
import { getCardsFor } from './api.js';
import { usePriceMap, valueOf, useRates, money, sumCurrency, ProgressNote } from './price.js';
import * as store from './store.js';
import { CardImage, LangPicker, setLine, Icon } from './app.js';
import { shrink, callScanner, matchDetection, Candidates, langOf, MAX_EDGE } from './scan.js';
import { VerdictBanner } from './verdict.js';

const FAIR_BAND = 0.15; // within 15% either way (or under £1 apart) is a fair swap

let nextKey = 1;

function searchPokemon(q) {
  const s = q.trim().toLowerCase().replace(/^#0*/, '');
  if (!s) return [];
  if (/^\d+$/.test(s)) return POKEDEX.filter((p) => String(p.dex).startsWith(s)).slice(0, 8);
  return POKEDEX.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 8);
}

// Pick a card by typing a Pokémon's name. On his side, his own card for that Pokémon is offered first.
function CardFinder({ side, onPick, onCancel }) {
  const [q, setQ] = useState('');
  const [poke, setPoke] = useState(null);
  const [state, setState] = useState(null);
  const choosePokemon = async (p) => {
    setPoke(p);
    setState({ loading: true });
    const r = await getCardsFor(p.dex, p.name);
    setState({ loading: false, ...r });
  };
  const owned = poke && store.getEntry(poke.dex).owned;
  const hisCard = side === 'his' && owned && !owned.unknown ? owned : null;
  return html`<div class="finder">
    ${!poke && html`<input type="search" autoFocus placeholder="Type a Pokémon, e.g. Gengar" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      <div class="suggest">${searchPokemon(q).map((p) => html`<a href="#" onClick=${(e) => { e.preventDefault(); choosePokemon(p); }}>
        <img class="sprite tiny" src=${spriteUrl(p.dex)} alt="" /> ${pad(p.dex)} ${p.name}</a>`)}</div>`}
    ${poke && html`<div>
      <div class="row-wrap"><b>${poke.name}</b><button class="btn small" onClick=${() => { setPoke(null); setState(null); }}>Change Pokémon</button></div>
      ${hisCard && html`<div class="row-wrap"><button class="btn primary" onClick=${() => onPick({ dex: poke.dex, card: hisCard, lang: hisCard.lang || 'EN' })}>
        Add your ${hisCard.name} (${hisCard.set} #${hisCard.num})</button></div>`}
      ${state?.loading && html`<p class="muted small">Loading ${poke.name} cards…</p>`}
      ${state?.error && html`<p class="error small">${state.error}</p>`}
      ${state && !state.loading && state.cards?.length > 0 && html`<p class="small muted">${hisCard ? 'Or tap' : 'Tap'} the card being traded:</p>
        <${Candidates} m=${{ candidates: state.cards }} chosen=${null} onChoose=${(c) => onPick({ dex: poke.dex, card: c, lang: 'EN' })} />`}
    </div>`}
    <p><button class="btn small" onClick=${onCancel}>Cancel</button></p>
  </div>`;
}

function Side({ side, title, items, total, cur, adding, ready, onScan, onFind, onRemove, onLang, prices, settings, rates, children }) {
  return html`<section class=${`trade-side side-${side}`}>
    <div class="trade-head">
      <h2>${title}</h2>
      <div class="trade-total">${items.length ? money(total, cur) : '–'}</div>
    </div>
    ${items.length === 0 && !adding && html`<p class="muted small">No cards added yet.</p>`}
    <div class="trade-items">
      ${items.map((it) => {
        const v = valueOf(prices.get(it.card.id), settings, rates);
        return html`<div class="trade-item" key=${it.key}>
          <${CardImage} card=${it.card} className="thumb" />
          <div class="grow">
            <div><b>${it.card.name}</b></div>
            <div class="muted small">${setLine(it.card)}</div>
            ${side === 'theirs' && html`<div class="row-wrap"><${VerdictBanner} dex=${it.dex} card=${it.card} lang=${it.lang} compact /></div>`}
            <${LangPicker} value=${it.lang} onChange=${(l) => onLang(it.key, l)} />
          </div>
          <div class="trade-price">${v == null ? html`<span class="muted small">no price</span>` : html`<b>${money(v, cur)}</b>`}</div>
          <button class="icon-btn small" aria-label="Remove" onClick=${() => onRemove(it.key)}>✕</button>
        </div>`;
      })}
    </div>
    ${children}
    ${!adding && html`<div class="row-wrap">
      <button class="btn" disabled=${!ready} onClick=${() => onScan(false)} title=${ready ? '' : 'Set up the scanner in Settings first'}><${Icon} name="camera" /> Scan a card</button>
      <button class="btn" onClick=${onFind}>Find by name</button>
    </div>`}
  </section>`;
}

export function TradeCheck({ ready, onDone }) {
  const settings = store.useSettings();
  const rates = useRates('GBP');
  const cur = sumCurrency(settings);
  const [items, setItems] = useState({ his: [], theirs: [] });
  const [adding, setAdding] = useState(null); // { side, phase: 'scanning' | 'choose' | 'find' | 'error', m, message }
  const fileRef = useRef(null);
  const scanSide = useRef(null); // which side the photo being taken is for

  const ids = useMemo(() => [...items.his, ...items.theirs].map((x) => x.card.id), [items]);
  const priceState = usePriceMap(ids);
  const totalOf = (side) => items[side].reduce((s, x) => s + (valueOf(priceState.prices.get(x.card.id), settings, rates) ?? 0), 0);
  const unpriced = [...items.his, ...items.theirs].filter((x) => !priceState.loading && valueOf(priceState.prices.get(x.card.id), settings, rates) == null).length;

  const add = (side, it) => {
    setItems((s) => ({ ...s, [side]: [...s[side], { ...it, key: nextKey++ }] }));
    setAdding(null);
  };
  const remove = (side) => (key) => setItems((s) => ({ ...s, [side]: s[side].filter((x) => x.key !== key) }));
  const setLangFor = (side) => (key, lang) => setItems((s) => ({ ...s, [side]: s[side].map((x) => (x.key === key ? { ...x, lang } : x)) }));

  const startScan = (side) => {
    scanSide.current = side;
    fileRef.current.click();
  };
  const onPhoto = async (file) => {
    const side = scanSide.current;
    if (!file || !side) return;
    setAdding({ side, phase: 'scanning' });
    try {
      const img = await shrink(file, MAX_EDGE.quick);
      const res = await callScanner(settings, { mode: 'quick', image: img.base64 });
      const det = (res.cards || [])[0];
      if (!det) throw new Error('No card found in that photo.');
      const m = await matchDetection(det);
      if (m.best && m.level !== 'guess') add(side, { dex: m.p.dex, card: m.best, lang: langOf(det) });
      else if (m.p && m.candidates.length) setAdding({ side, phase: 'choose', m });
      else throw new Error(m.loadError || "Couldn't tell which card that is. Try again, or use Find by name.");
    } catch (e) {
      setAdding({ side, phase: 'error', message: e.message || String(e) });
    }
  };

  const his = totalOf('his'), theirs = totalOf('theirs');
  const both = items.his.length > 0 && items.theirs.length > 0;
  let result = null;
  if (both && !priceState.loading) {
    const diff = theirs - his;
    const base = Math.max(his, theirs);
    const fair = base === 0 || Math.abs(diff) < 1 || Math.abs(diff) / base <= FAIR_BAND;
    result = fair
      ? { kind: 'fair', title: 'Fair trade 👍', detail: 'Both sides are worth about the same.' }
      : diff > 0
        ? { kind: 'good', title: 'Good deal for you!', detail: `You'd get about ${money(diff, cur)} more than you give.` }
        : { kind: 'bad', title: 'Careful — you give more', detail: `You'd be giving away about ${money(-diff, cur)} more than you get.` };
  }

  const addingPanel = (side) => {
    if (!adding || adding.side !== side) return null;
    if (adding.phase === 'scanning') return html`<div class="scan-working small-working"><img class="scan-gif" src="icons/loading-charmander.gif" alt="" width="348" height="231" /><p>Reading the card…</p></div>`;
    if (adding.phase === 'find') return html`<${CardFinder} side=${side} onPick=${(it) => add(side, it)} onCancel=${() => setAdding(null)} />`;
    if (adding.phase === 'choose') return html`<div class="finder">
      <p class="small">Which ${adding.m.p.name} card is it?</p>
      <${Candidates} m=${adding.m} chosen=${adding.m.best} onChoose=${(c) => add(side, { dex: adding.m.p.dex, card: c, lang: langOf(adding.m.det) })} />
      <button class="btn small" onClick=${() => setAdding(null)}>Cancel</button>
    </div>`;
    if (adding.phase === 'error') return html`<div class="finder"><p class="error small">${adding.message}</p>
      <button class="btn small" onClick=${() => setAdding(null)}>OK</button></div>`;
    return null;
  };

  const sideProps = { cur, ready, prices: priceState.prices, settings, rates };
  return html`<div class="trade">
    <input type="file" accept="image/*" capture="environment" hidden ref=${fileRef}
      onChange=${(e) => { const f = e.currentTarget.files[0]; e.currentTarget.value = ''; onPhoto(f); }} />
    <div class="row-wrap"><button class="btn small" onClick=${onDone}>← Back</button><h2 class="grow">Trade check</h2></div>

    <div class="trade-grid">
      <${Side} side="his" title="You give" items=${items.his} total=${his} adding=${adding?.side === 'his'}
        onScan=${() => startScan('his')} onFind=${() => setAdding({ side: 'his', phase: 'find' })} onRemove=${remove('his')} onLang=${setLangFor('his')} ...${sideProps}>
        ${addingPanel('his')}
      </${Side}>
      <${Side} side="theirs" title="You get" items=${items.theirs} total=${theirs} adding=${adding?.side === 'theirs'}
        onScan=${() => startScan('theirs')} onFind=${() => setAdding({ side: 'theirs', phase: 'find' })} onRemove=${remove('theirs')} onLang=${setLangFor('theirs')} ...${sideProps}>
        ${addingPanel('theirs')}
      </${Side}>
    </div>

    <${ProgressNote} state=${priceState} what="the cards" />
    ${result && html`<div class=${`trade-result t-${result.kind}`} role="status">
      <div class="verdict-title">${result.title}</div>
      <div>You give <b>${money(his, cur)}</b> · you get <b>${money(theirs, cur)}</b></div>
      <div class="small">${result.detail}</div>
    </div>`}
    ${!both && html`<p class="muted small">Add at least one card to each side to see if it's fair.</p>`}
    ${unpriced > 0 && html`<p class="muted small">${unpriced} card${unpriced === 1 ? " has" : 's have'} no price, so ${unpriced === 1 ? "it isn't" : "they aren't"} counted.</p>`}
    <p class="muted small">Values are typical recent sale prices for the English cards. Condition matters too — bent or scratched cards are worth less.</p>
  </div>`;
}
