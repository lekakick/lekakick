import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

export const article = {id:'1234567890abcdef',slug:'timnas-indonesia-berlatih',title:'Timnas Indonesia berlatih',excerpt:'Persiapan dari lapangan.',category:'timnas',url:'https://www.antaranews.com/berita/555/latihan',image:'',imageCredit:'',source:'ANTARA News',publishedAt:'2026-10-08T05:00:00.000Z'};

test('pengunjung dapat membuka beranda, mencari, membaca ringkasan, dan mendapat 404 yang benar', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp({snapshot: () => ({items:[article],updatedAt:article.publishedAt,lastAttemptAt:article.publishedAt,degraded:false})} as any);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const home = await fetch(base);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /GarisBola/);
    assert.match(html, /Timnas Indonesia berlatih/);
    assert.match(home.headers.get('content-security-policy')!, /script-src 'self'/);
    const search = await fetch(`${base}/berita?q=zzzz`);
    assert.match(await search.text(), /Belum ada hasil/);
    const detail = await fetch(`${base}/berita/${article.id}/${article.slug}`);
    assert.equal(detail.status,200);
    assert.match(await detail.text(), /Baca selengkapnya di ANTARA/);
    assert.equal((await fetch(`${base}/halaman-tidak-ada`)).status, 404);
    assert.equal((await fetch(`${base}/berita/0000000000000000/hilang`)).status, 404);
    const injection = await fetch(`${base}/berita?q=${encodeURIComponent('<script>alert(1)</script>')}`);
    assert.ok(!(await injection.text()).includes('<script>alert(1)</script>'));
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally { await new Promise<void>((resolve,reject) => server.close(err => err ? reject(err):resolve())); }
});
