import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Digest } from '../src/digest.js';

export const article = {id:'1234567890abcdef',slug:'timnas-indonesia-berlatih',title:'Timnas Indonesia berlatih',excerpt:'Persiapan dari lapangan.',category:'timnas',url:'https://www.antaranews.com/berita/555/latihan',image:'',imageCredit:'',source:'ANTARA News',publishedAt:'2026-10-08T05:00:00.000Z'};
export const fixtureDigests: Digest[] = JSON.parse(readFileSync(new URL('./fixtures/digests.json', import.meta.url), 'utf8')).items;

test('beranda, pencarian, dan detail hanya menampilkan rangkuman; halaman RSS lama hilang', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp({snapshot: () => ({items:[article],updatedAt:article.publishedAt,lastAttemptAt:article.publishedAt,degraded:false})} as any, {list: () => fixtureDigests});
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const home = await fetch(base);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /lekakick/);
    assert.match(html, new RegExp(fixtureDigests[0]!.title));
    assert.ok(!html.includes(article.title), 'artikel RSS tidak tampil di beranda');
    assert.match(home.headers.get('content-security-policy')!, /script-src 'self'/);
    assert.match(await (await fetch(`${base}/artikel?q=zzzz`)).text(), /Belum ada hasil/);
    const persib = await (await fetch(`${base}/artikel?q=persib`)).text();
    assert.match(persib, /Persib Bandung/);
    assert.ok(!persib.includes('Chelsea Pesta Gol'));
    const timnas = await (await fetch(`${base}/artikel?kategori=timnas`)).text();
    assert.ok(fixtureDigests.filter(d => d.category !== 'timnas').every(d => !timnas.includes(`>${d.title}</a>`)), 'filter kategori');
    const digest = fixtureDigests[0]!;
    const detail = await fetch(`${base}/artikel/${digest.id}/${digest.slug}`);
    assert.equal(detail.status, 200);
    const detailHtml = await detail.text();
    assert.ok(digest.sources.every(source => detailHtml.includes(source.url)));
    assert.ok(detailHtml.includes(`data-save="${digest.id}"`), 'artikel dapat disimpan');
    const old = await fetch(`${base}/berita/${article.id}/${article.slug}`);
    assert.equal(old.status, 410);
    assert.match(await old.text(), /noindex/);
    const listing = await fetch(`${base}/berita?kategori=timnas&sumber=antara&q=x`, {redirect:'manual'});
    assert.equal(listing.status, 301);
    assert.equal(listing.headers.get('location'), '/artikel?kategori=timnas&q=x');
    assert.equal((await fetch(`${base}/halaman-tidak-ada`)).status, 404);
    assert.equal((await fetch(`${base}/artikel/0000000000000000/hilang`)).status, 404);
    const injection = await fetch(`${base}/artikel?q=${encodeURIComponent('<script>alert(1)</script>')}`);
    assert.ok(!(await injection.text()).includes('<script>alert(1)</script>'));
    const saved = await (await fetch(`${base}/api/berita?ids=${digest.id},${article.id}`)).json() as {items:{id:string; path:string}[]};
    assert.deepEqual(saved.items.map(item => item.id), [digest.id], 'bookmark RSS lama tidak lagi tersedia');
    assert.equal(saved.items[0]!.path, `/artikel/${digest.id}/${digest.slug}`);
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.ok(!sitemap.includes('/berita'), 'sitemap tanpa halaman RSS');
    assert.ok(sitemap.includes(`/artikel/${digest.id}/${digest.slug}`));
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally { await new Promise<void>((resolve,reject) => server.close(err => err ? reject(err):resolve())); }
});
