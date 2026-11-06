// Price formatting and the "which price do we show" logic.

import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { getPrices, peekPrices, getRates, getManyPrices } from './api.js';
import { useSettings } from './store.js';

let ratesCache = null;
getRates().then((r) => { ratesCache = r; });

export function useRates(currency) {
  const [rates, setRates] = useState(ratesCache);
  useEffect(() => {
    if (currency === 'native' || ratesCache) return;
    let live = true;
    getRates().then((r) => { ratesCache = r; if (live) setRates(r); });
    return () => { live = false; };
  }, [currency]);
  return rates;
}

export function money(amount, unit) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: unit, maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount);
  } catch {
    return `${unit} ${amount.toFixed(2)}`;
  }
}

// Convert to the chosen display currency (if any). Returns [text, wasConverted].
export function fmt(amount, unit, currency, rates) {
  if (amount == null) return ['–', false];
  if (currency && currency !== 'native' && currency !== unit && rates && rates[unit] && rates[currency]) {
    const v = (amount / rates[unit]) * rates[currency];
    return ['≈' + money(v, currency), true];
  }
  return [money(amount, unit), false];
}

// The single "typical recent price" we show in lists.
export function headline(p, source) {
  if (!p) return null;
  const cm = p.cm && (p.cm.avg30 ?? p.cm.trend ?? p.cm.avg7 ?? p.cm.avg);
  const cmRes = cm != null ? { amount: cm, unit: p.cm.unit, src: 'Cardmarket 30-day avg' } : null;
  const tp = p.tp && p.tp.market;
  const tpRes = tp != null ? { amount: tp, unit: p.tp.unit, src: 'TCGplayer market' } : null;
  if (source === 'tcgplayer') return tpRes || cmRes;
  return cmRes || tpRes;
}

// Totals are added up in one currency: the chosen display currency, or the price source's own.
export function sumCurrency(settings) {
  if (settings.currency && settings.currency !== 'native') return settings.currency;
  return settings.priceSource === 'tcgplayer' ? 'USD' : 'EUR';
}

// A card's typical price as a plain number in sumCurrency (null if unknown).
export function valueOf(p, settings, rates) {
  const h = headline(p, settings.priceSource);
  if (!h) return null;
  const cur = sumCurrency(settings);
  if (h.unit === cur) return h.amount;
  if (!rates || !rates[h.unit] || !rates[cur]) return null;
  return (h.amount / rates[h.unit]) * rates[cur];
}

// Loads prices for a list of card ids with progress: { prices: Map, done, total, loading }.
export function usePriceMap(ids) {
  const key = [...new Set(ids.filter(Boolean))].sort().join(',');
  const [state, setState] = useState({ prices: new Map(), done: 0, total: 0, loading: true });
  useEffect(() => {
    let live = true;
    const list = key ? key.split(',') : [];
    setState((s) => ({ ...s, done: 0, total: list.length, loading: true }));
    let last = 0;
    getManyPrices(list, (done, total) => {
      const now = Date.now();
      if (live && (now - last > 250 || done === total)) { last = now; setState((s) => ({ ...s, done, total })); }
    }).then((prices) => { if (live) setState({ prices, done: list.length, total: list.length, loading: false }); });
    return () => { live = false; };
  }, [key]);
  return state;
}

export function ProgressNote({ state, what }) {
  if (!state.loading || !state.total) return null;
  return html`<div class="load-note">
    <div class="small">Checking prices for ${what}… ${state.done} of ${state.total}</div>
    <div class="progress"><div style=${`width:${(state.done / state.total) * 100}%`}></div></div>
  </div>`;
}

function useVisible(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible || !ref.current) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  return visible;
}

export function usePrices(id, enabled = true) {
  const [state, setState] = useState(() => (id ? peekPrices(id) || null : null));
  useEffect(() => {
    if (!enabled || !id) return;
    let live = true;
    setState(peekPrices(id) || null);
    getPrices(id).then((p) => live && setState(p), () => live && setState({ error: true }));
    return () => { live = false; };
  }, [id, enabled]);
  return state;
}

// Compact price for list rows; only fetches once scrolled into view.
export function PriceTag({ id, lang, cat }) {
  const ref = useRef(null);
  const visible = useVisible(ref);
  const settings = useSettings();
  const rates = useRates(settings.currency);
  const p = usePrices(id, visible);
  let body;
  if (!id) body = html`<span class="muted">–</span>`;
  else if (!p) body = html`<span class="muted">…</span>`;
  else if (p.error) body = html`<span class="muted">no price</span>`;
  else {
    const h = headline(p, settings.priceSource);
    body = h ? html`<b>${fmt(h.amount, h.unit, settings.currency, rates)[0]}</b>` : html`<span class="muted">no price</span>`;
  }
  return html`<span class="price-tag" ref=${ref} title=${lang && lang !== 'EN' && !cat ? 'Price is for the English card' : ''}>${body}</span>`;
}

// Full price breakdown for the card sheet.
const EBAY = { GBP: 'www.ebay.co.uk', AUD: 'www.ebay.com.au', CAD: 'www.ebay.ca', EUR: 'www.ebay.de' };

export function PriceBlock({ id, lang, name, query, cat }) {
  const settings = useSettings();
  const rates = useRates(settings.currency);
  const p = usePrices(id, true);
  if (!id) return null;
  if (!p) return html`<div class="prices"><div class="muted">Loading prices…</div></div>`;
  if (p.error) return html`<div class="prices"><div class="muted">Couldn't load prices (are you offline?)</div></div>`;
  const f = (a, u) => fmt(a, u, settings.currency, rates)[0];
  const h = headline(p, settings.priceSource);
  const q = encodeURIComponent(name || '');
  return html`<div class="prices">
    ${h ? html`<div class="price-headline">
        <div class="big">${f(h.amount, h.unit)}</div>
        <div class="muted small">Typical recent price · ${h.src}${settings.currency !== 'native' && settings.currency !== h.unit ? ` (${fmt(h.amount, h.unit, 'native')[0]})` : ''}</div>
      </div>`
      : html`<div class="muted">No recent sales data for this card.</div>`}
    <table class="price-table">
      ${p.cm && html`<tr><th>Cardmarket (EU/UK)</th><td>
        30-day avg <b>${f(p.cm.avg30, p.cm.unit)}</b> · 7-day <b>${f(p.cm.avg7, p.cm.unit)}</b>
        ${p.cm.low ? html` · lowest listing ${f(p.cm.low, p.cm.unit)}` : ''}
        ${p.cm.rev30 ? html`<br/>Reverse holo 30-day ${f(p.cm.rev30, p.cm.unit)}` : ''}
      </td></tr>`}
      ${p.tp && html`<tr><th>TCGplayer (US)</th><td>
        Market <b>${f(p.tp.market, p.tp.unit)}</b>${p.tp.low ? html` · low ${f(p.tp.low, p.tp.unit)}` : ''}
        ${p.tp.rev ? html`<br/>Reverse holo ${f(p.tp.rev, p.tp.unit)}` : ''}
      </td></tr>`}
    </table>
    ${cat ? html`<div class="note ok-note">✓ Prices for this ${cat === 'ko' ? 'Korean' : 'Japanese'} card (Cardmarket / TCGplayer).</div>`
      : lang && lang !== 'EN' ? html`<div class="note">⚠️ These prices are for the <b>English</b> card. ${lang === 'JP' ? 'Japanese' : 'Korean'} versions usually sell for a different (often lower) price.
          ${lang === 'JP' ? html` Pick the actual Japanese card (switch to <b>Japanese cards</b> in the card list) for its real price.` : ''}</div>` : ''}
    <div class="muted small links">
      ${p.updated ? `Updated ${new Date(p.updated).toLocaleDateString()}${p.stale ? ' (saved copy – offline)' : ''} · ` : ''}
      ${p.tp?.productId ? html`<a href=${`https://www.tcgplayer.com/product/${p.tp.productId}`} target="_blank" rel="noopener">TCGplayer</a> · ` : ''}
      <a href=${`https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${q}`} target="_blank" rel="noopener">Cardmarket</a> ·
      <a href=${`https://${EBAY[settings.currency] || 'www.ebay.com'}/sch/i.html?_nkw=${encodeURIComponent(query || name || '')}&LH_Sold=1&LH_Complete=1`} target="_blank" rel="noopener">eBay sold</a>
    </div>
  </div>`;
}
