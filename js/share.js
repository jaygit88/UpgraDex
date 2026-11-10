// "Share my swaps": draws the swaps list as one picture (card pictures, names, prices and a total)
// that can be sent with Android's share menu, saved, or copied as text.

import { html, useState, useEffect, useMemo } from '../vendor/preact-htm.js';
import { cardPicture } from './data.js';
import { priceKey } from './api.js';
import { usePriceMap, valueOf, useRates, money, sumCurrency } from './price.js';
import { rarityLabel } from './rarity.js';
import * as store from './store.js';
import { toast } from './app.js';

const MAX_CARDS = 120; // keeps the picture a sensible size
const LANG_NAMES = { EN: 'English', JP: 'Japanese', KR: 'Korean' };

async function loadPicture(card) {
  const src = cardPicture(card, 'low');
  if (!src) return null;
  try {
    const res = await fetch(src, { mode: 'cors' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

// rows: [{ dex, slot, each, total }] already sorted. Returns a PNG Blob.
export async function drawSwapsPicture({ rows, cur, showPrices, title }) {
  const list = rows.slice(0, MAX_CARDS);
  const cols = list.length <= 4 ? Math.max(1, list.length) : list.length <= 9 ? 3 : 4;
  const cellW = 250, imgH = 300, textH = showPrices ? 92 : 70, gap = 18, padX = 28, headH = 132, footH = 56;
  const rowsN = Math.ceil(list.length / cols) || 1;
  const W = Math.max(600, padX * 2 + cols * cellW + (cols - 1) * gap);
  const H = headH + rowsN * (imgH + textH + gap) + footH;
  const scale = 1;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // Background and heading
  ctx.fillStyle = '#f4f5fb'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#6d28d9'; ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = '#1c1d26';
  ctx.font = '700 40px system-ui, sans-serif';
  ctx.fillText(fitText(ctx, title, W - padX * 2), padX, 62);
  const count = rows.reduce((n, r) => n + r.slot.qty, 0);
  const value = rows.reduce((n, r) => n + (r.total || 0), 0);
  ctx.font = '24px system-ui, sans-serif'; ctx.fillStyle = '#4b4f60';
  const pokemon = new Set(rows.map((r) => r.dex)).size;
  ctx.fillText(`${count} card${count === 1 ? '' : 's'} · ${pokemon} Pokémon${showPrices ? ` · worth about ${money(value, cur)}` : ''}`, padX, 104);

  const pics = await Promise.all(list.map((r) => loadPicture(r.slot)));
  list.forEach((r, i) => {
    const x = padX + (i % cols) * (cellW + gap);
    const y = headH + Math.floor(i / cols) * (imgH + textH + gap);
    // card picture (or a plain card shape with its name)
    const pic = pics[i];
    const w = imgH * (63 / 88), ix = x + (cellW - w) / 2;
    if (pic) ctx.drawImage(pic, ix, y, w, imgH);
    else {
      ctx.fillStyle = '#e4e6ef'; ctx.fillRect(ix, y, w, imgH);
      ctx.fillStyle = '#6b6f80'; ctx.font = '600 18px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(fitText(ctx, r.slot.name, w - 16), x + cellW / 2, y + imgH / 2);
      ctx.textAlign = 'left';
    }
    if (r.slot.qty > 1) {
      ctx.fillStyle = '#6d28d9'; ctx.beginPath(); ctx.arc(ix + w - 8, y + 10, 24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 20px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`×${r.slot.qty}`, ix + w - 8, y + 17); ctx.textAlign = 'left';
    }
    let ty = y + imgH + 26;
    ctx.fillStyle = '#1c1d26'; ctx.font = '700 19px system-ui, sans-serif';
    ctx.fillText(fitText(ctx, r.slot.name, cellW), x, ty);
    ty += 23; ctx.fillStyle = '#6b6f80'; ctx.font = '16px system-ui, sans-serif';
    const lang = r.slot.lang && r.slot.lang !== 'EN' ? ` · ${LANG_NAMES[r.slot.lang] || r.slot.lang}` : '';
    ctx.fillText(fitText(ctx, `${r.slot.set || ''}${r.slot.num ? ' #' + r.slot.num : ''}${lang}`, cellW), x, ty);
    ty += 21;
    if (r.slot.rarity) ctx.fillText(fitText(ctx, rarityLabel(r.slot.rarity), cellW), x, ty);
    if (showPrices) {
      ty += 23; ctx.fillStyle = '#1f7a45'; ctx.font = '700 19px system-ui, sans-serif';
      ctx.fillText(r.each == null ? 'no price' : `${money(r.each, cur)}${r.slot.qty > 1 ? ' each' : ''}`, x, ty);
    }
  });

  ctx.fillStyle = '#6b6f80'; ctx.font = '16px system-ui, sans-serif';
  const more = rows.length > list.length ? ` · plus ${rows.length - list.length} more` : '';
  ctx.fillText(`UpgraDex · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}${showPrices ? ' · typical recent sale prices' : ''}${more}`, padX, H - 22);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function swapsText(rows, cur, showPrices, title) {
  const lines = rows.map((r) => `• ${r.slot.name} – ${r.slot.set || ''}${r.slot.num ? ' #' + r.slot.num : ''}${r.slot.lang && r.slot.lang !== 'EN' ? ` (${LANG_NAMES[r.slot.lang]})` : ''}${r.slot.qty > 1 ? ` ×${r.slot.qty}` : ''}${showPrices && r.each != null ? ` – ${money(r.each, cur)}${r.slot.qty > 1 ? ' each' : ''}` : ''}`);
  const value = rows.reduce((n, r) => n + (r.total || 0), 0);
  return `${title}\n${lines.join('\n')}${showPrices ? `\nTotal: about ${money(value, cur)}` : ''}`;
}

export function ShareSwapsSheet() {
  const entries = store.useCollection();
  const settings = store.useSettings();
  const rates = useRates('GBP');
  const cur = sumCurrency(settings);
  const swaps = useMemo(() => store.allSwaps(entries), [entries]);
  const priceState = usePriceMap(swaps.map((s) => priceKey(s.slot)));
  const [showPrices, setShowPrices] = useState(true);
  const [title, setTitle] = useState('My Pokémon card swaps');
  const [pic, setPic] = useState(null); // { blob, url }
  const [busy, setBusy] = useState(false);

  const rows = swaps.map((s) => {
    const each = valueOf(priceState.prices.get(priceKey(s.slot)), settings, rates);
    return { ...s, each, total: each == null ? null : each * s.slot.qty };
  }).sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.dex - b.dex);

  // Redraw when the options or prices change.
  const sig = `${showPrices}|${title}|${priceState.loading}|${rows.map((r) => r.slot.id + r.slot.qty + r.each).join()}`;
  useEffect(() => {
    if (!rows.length || priceState.loading) return;
    let live = true;
    setBusy(true);
    drawSwapsPicture({ rows, cur, showPrices, title: title.trim() || 'My swaps' }).then((blob) => {
      if (!live || !blob) return;
      setPic((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob) }; });
      setBusy(false);
    });
    return () => { live = false; };
  }, [sig]);

  const fileName = 'my-swaps.png';
  const share = async () => {
    const file = new File([pic.blob], fileName, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: title || 'My swaps' }); } catch {}
    } else save();
  };
  const save = () => {
    const a = document.createElement('a');
    a.href = pic.url; a.download = fileName; a.click();
    toast({ msg: 'Picture saved to your downloads' });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(swapsText(rows, cur, showPrices, title.trim() || 'My swaps')); toast({ msg: 'List copied – paste it into a message' }); }
    catch { toast({ msg: "Couldn't copy on this device" }); }
  };

  if (!swaps.length) return html`<div class="sheet-body single"><h2>Share your swaps</h2><p class="muted">Add some swaps first.</p></div>`;
  return html`<div class="sheet-body single share-swaps">
    <h2>Share your swaps</h2>
    <p class="muted small">Makes a picture of your swaps to show friends or send in a message.</p>
    <label>Title <input value=${title} onInput=${(e) => setTitle(e.currentTarget.value)} maxlength="40" /></label>
    <label class="check"><input type="checkbox" checked=${showPrices} onChange=${(e) => setShowPrices(e.currentTarget.checked)} /> Show prices</label>
    <div class="share-preview">
      ${pic && !busy ? html`<img src=${pic.url} alt="Picture of your swaps" />` : html`<p class="muted center spaced">${priceState.loading ? 'Getting prices…' : 'Drawing your picture…'}</p>`}
    </div>
    <div class="row-wrap actions">
      <button class="btn primary" disabled=${!pic || busy} onClick=${share}>📤 Share picture</button>
      <button class="btn" disabled=${!pic || busy} onClick=${save}>⬇️ Save picture</button>
      <button class="btn" onClick=${copy}>📋 Copy as text</button>
    </div>
    ${rows.length > MAX_CARDS && html`<p class="muted small">The picture shows your ${MAX_CARDS} most valuable swaps; the text has them all.</p>`}
  </div>`;
}
