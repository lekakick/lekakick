import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { ReportLog } from '../src/reports.js';
import { fixtureDigests } from './app.test.js';

const long = {...fixtureDigests[1]!, id:'abcdefabcdefabcd', slug:'judul-panjang', title:'Judul yang sangat panjang sekali untuk menguji apakah akhiran merek dibuang'};
const digests = [...fixtureDigests, long];

test('favicon, gambar bagikan bawaan, breadcrumb, dan judul halaman ramah mesin pencari', async () => {
  const app = createApp({snapshot: () => ({items:[], updatedAt:null, lastAttemptAt:null, degraded:false})}, {list: () => digests});
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const ico = await fetch(`${base}/favicon.ico`);
    assert.equal(ico.status, 200);
    assert.equal(Buffer.from(await ico.arrayBuffer()).readUInt16LE(2), 1, 'berkas ICO valid');
    assert.equal((await fetch(`${base}/apple-touch-icon.png`)).status, 200);
    const home = await (await fetch(base)).text();
    assert.ok(home.includes('/assets/og-default.jpg') && home.includes('rel="icon" href="/favicon.ico"'));
    const digest = fixtureDigests[0]!;
    const detail = await (await fetch(`${base}/artikel/${digest.id}/${digest.slug}`)).text();
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(detail)![1]!);
    const crumbs = ld['@graph'].find((node: {'@type': string}) => node['@type'] === 'BreadcrumbList');
    assert.deepEqual(crumbs.itemListElement.map((item: {name: string}) => item.name), ['Beranda', 'Artikel', 'Timnas', digest.title]);
    assert.ok(ld['@graph'].some((node: {'@type': string}) => node['@type'] === 'NewsArticle'));
    assert.match(detail, new RegExp(`<title>${digest.title} — lekakick</title>`));
    const longHtml = await (await fetch(`${base}/artikel/${long.id}/${long.slug}`)).text();
    assert.match(longHtml, new RegExp(`<title>${long.title}</title>`), 'judul panjang tanpa akhiran merek');
    const listing = await (await fetch(`${base}/artikel?kategori=timnas`)).text();
    assert.match(listing, /"BreadcrumbList"/);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

test('laporan kesalahan tersimpan, bot dan pengirim berulang dibatasi', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'lapor-'));
  const app = createApp({snapshot: () => ({items:[], updatedAt:null, lastAttemptAt:null, degraded:false})}, {list: () => digests}, new ReportLog(dataDir));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const digest = fixtureDigests[0]!;
  const send = (fields: Record<string, string>) => fetch(`${base}/artikel/${digest.id}/lapor`, {method:'POST', redirect:'manual',
    headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams(fields)});
  try {
    const ok = await send({jenis:'fakta', catatan:'Skor   seharusnya 2-1'});
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), `/artikel/${digest.id}/${digest.slug}?lapor=terkirim#lapor`);
    assert.equal((await send({jenis:'ngawur'})).headers.get('location')?.includes('lapor=gagal'), true);
    assert.equal((await send({jenis:'fakta', website:'http://spam'})).headers.get('location')?.includes('lapor=terkirim'), true, 'bot tetap melihat sukses');
    const saved = (await readFile(path.join(dataDir, 'laporan.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(saved.length, 1, 'laporan bot tidak disimpan');
    assert.deepEqual([saved[0].digestId, saved[0].kind, saved[0].note], [digest.id, 'fakta', 'Skor seharusnya 2-1']);
    for (let i = 0; i < 4; i++) await send({jenis:'bahasa'});
    assert.equal((await send({jenis:'bahasa'})).headers.get('location')?.includes('lapor=batas'), true, 'maks 5 laporan per jam');
    const page = await (await fetch(`${base}/artikel/${digest.id}/${digest.slug}?lapor=terkirim`)).text();
    assert.ok(page.includes('laporan Anda sudah kami terima') && page.includes('id="lapor" open'));
    assert.equal((await fetch(`${base}/artikel/0000000000000000/lapor`, {method:'POST'})).status, 404);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    await rm(dataDir, {recursive:true, force:true});
  }
});
