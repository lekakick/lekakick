import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, legacyListingTarget } from '../src/app.js';
import { CATEGORIES } from '../src/news.js';
import { REPORT_KINDS } from '../src/reports.js';
import { exportSite, fileFor } from '../src/static.js';
import { fixtureDigests } from './app.test.js';
// @ts-expect-error -- modul JS tanpa deklarasi tipe, dipakai Cloudflare Pages Functions.
import * as edge from '../edge/site.js';

test('kode Cloudflare (edge/site.js) selaras dengan kategori, jenis laporan, dan pengalihan di server', () => {
  assert.deepEqual(edge.CATEGORY_IDS, CATEGORIES.filter(c => c.id !== 'semua').map(c => c.id));
  assert.deepEqual(edge.REPORT_KINDS, Object.keys(REPORT_KINDS));
  for (const query of ['', 'kategori=timnas', 'kategori=timnas&halaman=3', 'halaman=1', 'kategori=bogus', 'q=Persib&kategori=timnas', 'q=%20', 'halaman=-1']) {
    assert.equal(edge.legacyListingTarget(new URLSearchParams(query)), legacyListingTarget(Object.fromEntries(new URLSearchParams(query))), query);
  }
});

test('ekspor statis menulis semua halaman, halaman bernomor, error page, dan aturan Cloudflare', async () => {
  // 13 artikel timnas → kategori timnas punya 2 halaman.
  const digests = Array.from({length: 13}, (_, i) => ({...fixtureDigests[0]!, id: i.toString(16).padStart(16, 'a'), slug: `artikel-${i}`, category: 'timnas' as const}));
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'static-'));
  try {
    const app = createApp({snapshot: () => ({items: [], updatedAt: null, lastAttemptAt: null, degraded: false})}, {list: () => digests});
    await exportSite(app, digests, outDir);
    const read = (file: string) => readFile(path.join(outDir, file), 'utf8');
    for (const file of ['index.html', 'artikel.html', 'artikel/halaman/2.html', 'artikel/kategori/timnas/halaman/2.html', `artikel/${digests[0]!.id}/artikel-0.html`,
      'cari.html', 'simpan.html', 'tentang.html', '404.html', '410.html', 'sitemap.xml', 'robots.txt', 'api/artikel.json', 'api/status.json',
      'favicon.ico', 'assets/styles.css', 'assets/fonts/dm-sans-latin-400-normal.woff2']) await stat(path.join(outDir, file));
    await assert.rejects(stat(path.join(outDir, 'artikel/kategori/transfer.html')), 'kategori kosong tidak diekspor');
    assert.equal(fileFor('/'), 'index.html');
    assert.equal(fileFor('/sitemap.xml'), 'sitemap.xml');
    const html = await read('index.html') + await read('artikel/kategori/timnas.html') + await read(`artikel/${digests[0]!.id}/artikel-0.html`);
    assert.ok(!/href="\/artikel\?/.test(html), 'tidak ada tautan query yang tidak bisa dilayani berkas statis');
    assert.match(await read('artikel/kategori/timnas/halaman/2.html'), /<link rel="canonical" href="https:\/\/lekakick.com\/artikel\/kategori\/timnas\/halaman\/2">/);
    assert.match(await read('404.html'), /noindex/);
    const headers = await read('_headers');
    assert.match(headers, /content-security-policy: default-src 'self'/);
    assert.match(headers, /\/assets\/fonts\/dm-sans-latin-400-normal\.woff2\n {2}Cache-Control: public, max-age=31536000, immutable/);
    assert.deepEqual(JSON.parse(await read('_routes.json')).include, ['/artikel', '/berita', '/berita/*', '/api/lapor']);
    assert.equal(JSON.parse(await read('api/artikel.json')).items.length, 13);
  } finally { await rm(outDir, {recursive: true, force: true}); }
});
