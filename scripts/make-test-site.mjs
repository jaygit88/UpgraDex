// Turns a copy of the app into the "UpgraDex Test" build (separate name, colour and icons),
// so it can be installed next to the real app. Usage: node scripts/make-test-site.mjs <dir>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: make-test-site.mjs <dir>');
const PURPLE = '#6d28d9';

const manifestPath = path.join(dir, 'manifest.webmanifest');
const m = JSON.parse(await readFile(manifestPath, 'utf8'));
m.name = 'UpgraDex Test';
m.short_name = 'UpgraDex Test';
m.theme_color = PURPLE;
m.icons = m.icons.map((i) => ({ ...i, src: i.src.replace('icons/', 'icons/test-') }));
await writeFile(manifestPath, JSON.stringify(m, null, 2));

const htmlPath = path.join(dir, 'index.html');
let h = await readFile(htmlPath, 'utf8');
h = h.replace(/<title>[^<]*<\/title>/, '<title>UpgraDex Test</title>')
  .replace(/(name="theme-color" content=")[^"]*"/, `$1${PURPLE}"`)
  .replace(/(name="apple-mobile-web-app-title" content=")[^"]*"/, '$1UpgraDex Test"')
  .replace(/href="icons\/(favicon-64|apple-touch-icon)\.png"/g, 'href="icons/test-$1.png"');
await writeFile(htmlPath, h);
console.log('Test build ready in', dir);
