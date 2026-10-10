// Membuat favicon raster dan gambar bagikan bawaan dari aset SVG. Jalankan: node scripts/build-icons.mjs
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const svg = await readFile('public/favicon.svg', 'utf8');
const font = (await readFile('public/fonts/barlow-condensed-latin-700-normal.woff2')).toString('base64');
const browser = await chromium.launch();
const render = async (html, width, height, type = 'png') => {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot(type === 'png' ? { omitBackground: true, clip: { x: 0, y: 0, width, height } } : { type, quality: 88, clip: { x: 0, y: 0, width, height } });
  await page.close();
  return png;
};
const icon = size => render(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`, size, size);

const sizes = {};
for (const size of [16, 32, 48, 96, 180, 192, 512]) sizes[size] = await icon(size);
for (const size of [48, 96, 192, 512]) await writeFile(`public/icon-${size}.png`, sizes[size]);
await writeFile('public/apple-touch-icon.png', sizes[180]);

// ICO berisi PNG 16/32/48 (didukung semua browser modern dan Google).
const entries = [16, 32, 48].map(size => ({ size, data: sizes[size] }));
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(({ size, data }, i) => {
  const at = 6 + i * 16;
  header.writeUInt8(size, at); header.writeUInt8(size, at + 1);
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(data.length, at + 8); header.writeUInt32LE(offset, at + 12);
  offset += data.length;
});
await writeFile('public/favicon.ico', Buffer.concat([header, ...entries.map(e => e.data)]));

const og = await render(`<style>
@font-face{font-family:B;src:url(data:font/woff2;base64,${font})}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:radial-gradient(900px 500px at 90% -10%,#1d5a35 0%,transparent 70%),linear-gradient(160deg,#07130c,#0f2419);color:#fff;font-family:B,sans-serif;padding:80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}
.brand{display:flex;align-items:center;gap:26px;font-size:96px;letter-spacing:-2px}.brand svg{width:110px;height:110px}.dot{color:#b9f24a}
h1{font-size:92px;line-height:.95;text-transform:uppercase;max-width:900px}h1 span{color:#b9f24a}
p{font:600 30px Arial,sans-serif;color:#a9b9ad}
.ring{position:absolute;right:-160px;bottom:-160px;width:560px;height:560px;border:3px solid #ffffff14;border-radius:50%}
.ring:after{content:'';position:absolute;inset:80px;border:3px solid #ffffff10;border-radius:50%}
</style><div class="ring"></div><div class="brand">${svg}<span>lekakick<span class="dot">.</span></span></div><h1>Kabar bola, <span>dari semua sisi.</span></h1><p>Rangkuman sepak bola Indonesia &amp; dunia dari berbagai media</p>`, 1200, 630, 'jpeg');
await writeFile('public/og-default.jpg', og);
await browser.close();
console.log('ikon & og-default dibuat');
