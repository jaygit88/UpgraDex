// Renders icons/icon.svg to the PNG sizes the manifest needs (uses Playwright's Chromium).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../icons/icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shots = [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0.0001], ['icon-maskable-512.png', 512, 0.12]];
  for (const [name, size, pad] of shots) {
    await page.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - pad * 2));
    const bg = pad ? '#e3350d' : 'transparent';
    await page.setContent(`<html><body style="margin:0;background:${bg};display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
    await page.screenshot({ path: path.join(__dirname, '../icons', name), omitBackground: !pad });
  }
  await browser.close();
})();
