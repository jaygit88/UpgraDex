// Price changes: how the collection's value has moved, and which cards went up or down —
// including upgrades that got cheaper (a good time to buy) and swaps that are worth more.

import { html, useMemo, useState, useRef } from '../vendor/preact-htm.js';
import { POKEDEX, pad } from './data.js';
import { priceKey } from './api.js';
import { usePriceMap, valueOf, useRates, money, sumCurrency, ProgressNote } from './price.js';
import { cardChange, useHistory, totalsHistory, dayDate, today } from './history.js';
import * as store from './store.js';
import { openSheet, CardImage, Icon, speciesName, setLine } from './app.js';

const PERIODS = [[7, 'Week'], [30, 'Month'], [90, '3 months']];
const fmtDay = (d) => dayDate(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function pctText(pct) {
  const a = Math.abs(pct);
  return `${pct >= 0 ? '▲' : '▼'} ${a >= 10 ? Math.round(a) : a.toFixed(1).replace(/\.0$/, '')}%`;
}

// Collection value over time: one line, a crosshair and a tooltip when you touch it.
function ValueChart({ points, cur }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  if (points.length < 2) return null;
  const W = 640, H = 200, L = 8, R = 8, T = 16, B = 26;
  const vals = points.map((p) => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const padV = (hi - lo) * 0.15 || hi * 0.05 || 1;
  lo = Math.max(0, lo - padV); hi += padV;
  const d0 = points[0].d, d1 = points[points.length - 1].d;
  const x = (d) => L + ((d - d0) / Math.max(1, d1 - d0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(d1).toFixed(1)},${H - B} L${x(d0).toFixed(1)},${H - B} Z`;
  const move = (e) => {
    const box = ref.current.getBoundingClientRect();
    const px = ((e.touches ? e.touches[0].clientX : e.clientX) - box.left) / box.width * W;
    let best = points[0];
    for (const p of points) if (Math.abs(x(p.d) - px) < Math.abs(x(best.d) - px)) best = p;
    setHover(best);
  };
  const h = hover;
  return html`<div class="value-chart">
    <svg ref=${ref} viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`Collection value from ${money(points[0].v, cur)} on ${fmtDay(d0)} to ${money(points[points.length - 1].v, cur)} on ${fmtDay(d1)}`}
      onMouseMove=${move} onTouchStart=${move} onTouchMove=${move} onMouseLeave=${() => setHover(null)}>
      <line class="axis" x1=${L} x2=${W - R} y1=${H - B} y2=${H - B} />
      <path class="area" d=${area} />
      <path class="line" d=${path} />
      <text class="tick" x=${L} y=${H - 6}>${fmtDay(d0)}</text>
      <text class="tick" x=${W - R} y=${H - 6} text-anchor="end">${fmtDay(d1)}</text>
      ${h && html`<g>
        <line class="cross" x1=${x(h.d)} x2=${x(h.d)} y1=${T} y2=${H - B} />
        <circle class="dot" cx=${x(h.d)} cy=${y(h.v)} r="5" />
      </g>`}
      <circle class="dot end" cx=${x(d1)} cy=${y(points[points.length - 1].v)} r="4" />
    </svg>
    <div class="chart-tip small" aria-live="polite">${h ? html`<b>${money(h.v, cur)}</b> on ${fmtDay(h.d)}` : html`<span class="muted">Touch the line to see the value on a day</span>`}</div>
  </div>`;
}

function MoverList({ title, hint, rows, cur, empty }) {
  return html`<section class="movers">
    <h2>${title}</h2>
    ${hint && html`<p class="muted small">${hint}</p>`}
    ${rows.length === 0 ? html`<p class="muted small">${empty}</p>` : html`<div class="shop-list">
      ${rows.map((r) => html`<button class="shop-row" key=${r.key + r.where} onClick=${() => openSheet(r.sheet)}>
        <${CardImage} card=${r.card} className="thumb" />
        <div class="grow">
          <div><span class="muted">${pad(r.dex)}</span> <b>${speciesName(r.dex)}</b>${r.qty > 1 ? html` <span class="muted">×${r.qty}</span>` : ''}</div>
          <div class="small">${r.card.name}</div>
          <div class="muted small">${setLine(r.card)}</div>
        </div>
        <div class="mover-price">
          <span class=${`change ${r.c.pct >= 0 ? 'up' : 'down'}`}>${pctText(r.c.pct)}</span>
          <div class="small"><b>${money(r.now, cur)}</b></div>
          <div class="muted small">was ${money(r.was, cur)}</div>
        </div>
      </button>`)}
    </div>`}
  </section>`;
}

export function ChangesScreen() {
  const entries = store.useCollection();
  const settings = store.useSettings();
  const rates = useRates('GBP');
  const cur = sumCurrency(settings);
  useHistory();
  const [days, setDays] = useState(30);

  const items = useMemo(() => {
    const out = [];
    for (const p of POKEDEX) {
      const e = entries[p.dex];
      if (!e) continue;
      if (e.owned && !e.owned.unknown && !e.owned.custom) out.push({ where: 'owned', dex: p.dex, card: e.owned, sheet: { kind: 'slot', dex: p.dex, where: 'owned' } });
      if (e.ups?.[0] && !e.ups[0].custom) out.push({ where: 'up', dex: p.dex, card: e.ups[0], sheet: { kind: 'slot', dex: p.dex, where: 0 } });
      (e.swaps || []).forEach((s, i) => !s.custom && out.push({ where: 'swap', dex: p.dex, card: s, qty: s.qty, sheet: { kind: 'swap', dex: p.dex, index: i } }));
    }
    return out;
  }, [entries]);
  const priceState = usePriceMap(items.map((x) => priceKey(x.card)));

  // Convert a native-currency amount into the totals currency, like valueOf does.
  const conv = (amount, p) => {
    const unit = settings.priceSource === 'tcgplayer' && p?.tp?.market != null ? p.tp.unit : p?.cm?.unit || p?.tp?.unit;
    if (unit === cur) return amount;
    if (!rates || !rates[unit] || !rates[cur]) return null;
    return (amount / rates[unit]) * rates[cur];
  };
  const moved = items.map((x) => {
    const key = priceKey(x.card);
    const p = priceState.prices.get(key);
    const c = cardChange(key, p, settings.priceSource, days);
    if (!c || Math.abs(c.pct) < 3) return null;
    const now = valueOf(p, settings, rates);
    const was = conv(c.from, p);
    if (now == null || was == null) return null;
    return { ...x, key, c, now, was };
  }).filter(Boolean);
  const top = (list, dir) => list.filter((r) => (dir > 0 ? r.c.pct > 0 : r.c.pct < 0)).sort((a, b) => dir * (b.c.pct - a.c.pct) || b.now - a.now).slice(0, 6);
  const owned = moved.filter((r) => r.where === 'owned');
  const usingRecent = moved.length > 0 && moved.every((r) => r.c.kind === 'recent');

  const totals = totalsHistory().filter((t) => t[0] >= today() - days).map((t) => ({ d: t[0], v: t[1] }));
  const first = totals[0], last = totals[totals.length - 1];
  const diff = first && last && first !== last ? last.v - first.v : null;
  const period = PERIODS.find((p) => p[0] === days)[1].toLowerCase();

  return html`<div class="pad narrow changes">
    <div class="row-wrap"><a class="icon-btn" href="#/summary" aria-label="Back"><${Icon} name="back" /></a><h1 class="grow">Price changes</h1></div>
    <div class="seg" role="group" aria-label="Period">
      ${PERIODS.map(([d, label]) => html`<button class=${days === d ? 'on' : ''} aria-pressed=${days === d} onClick=${() => setDays(d)}>${label}</button>`)}
    </div>

    <section class="hero-value">
      <div class="muted small">Your collection's value</div>
      ${totals.length >= 2
        ? html`<div class="hero-number">${money(last.v, cur)}</div>
            <div class=${`change big ${diff >= 0 ? 'up' : 'down'}`}>${diff >= 0 ? '▲' : '▼'} ${money(Math.abs(diff), cur)} ${first.v > 0 ? `(${pctText((diff / first.v) * 100).slice(2)})` : ''} since ${fmtDay(first.d)}</div>
            <${ValueChart} points=${totals} cur=${cur} />`
        : html`<p class="small">The app notes your collection's value once a day. Come back in a few days to see it move.</p>`}
    </section>
    <${ProgressNote} state=${priceState} what="your cards" />
    ${usingRecent && html`<p class="muted small">Not much history saved yet, so these compare each card's price this week with its average over the month. Real ${period} changes will show as the app keeps track.</p>`}

    <${MoverList} title="📈 Your cards going up" rows=${top(owned, 1)} cur=${cur}
      empty=${priceState.loading ? 'Working it out…' : `None of your cards went up much this ${period}.`} />
    <${MoverList} title="📉 Your cards going down" rows=${top(owned, -1)} cur=${cur}
      empty=${priceState.loading ? 'Working it out…' : `None of your cards dropped much this ${period}.`} />
    <${MoverList} title="🛒 Upgrades getting cheaper" hint="Your #1 upgrade picks that dropped in price – a good time to buy." rows=${top(moved.filter((r) => r.where === 'up'), -1)} cur=${cur}
      empty=${priceState.loading ? 'Working it out…' : 'None of your top upgrades got cheaper.'} />
    <${MoverList} title="🔁 Swaps worth more" hint="Spare cards that went up – handy to know before you trade them." rows=${top(moved.filter((r) => r.where === 'swap'), 1)} cur=${cur}
      empty=${priceState.loading ? 'Working it out…' : 'None of your swaps went up much.'} />
    <p class="muted small">Prices are typical recent sale prices (${settings.priceSource === 'tcgplayer' ? 'TCGplayer' : 'Cardmarket 30-day average'}), so changes show up gradually. Only moves of 3% or more are listed. Price history is kept on this device.</p>
  </div>`;
}
