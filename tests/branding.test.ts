import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Article } from '../src/news.js';
import { createApp } from '../src/app.js';
import { fixtureDigests } from './app.test.js';

test('seluruh halaman dan ilustrasi memakai merek lekakick secara konsisten', async () => {
  const article: Article = {id:'1234567890abcdef',slug:'kabar-timnas',title:'Kabar Timnas',excerpt:'Kabar dari lapangan.',category:'timnas',url:'https://www.antaranews.com/berita/555/latihan',image:'',imageCredit:'',source:'ANTARA News',publishedAt:'2026-10-08T05:00:00.000Z'};
  const app = createApp({snapshot: () => ({items:[article],updatedAt:article.publishedAt,lastAttemptAt:article.publishedAt,degraded:false})}, {list: () => fixtureDigests});
  const server = app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const digest = fixtureDigests[0]!;
    for (const route of ['/', '/artikel', '/cari?q=Timnas', '/simpan', '/tentang', '/privasi', `/artikel/${digest.id}/${digest.slug}`, '/tidak-ada']) {
      const response = await fetch(base+route);
      const html = await response.text();
      assert.equal(response.status, route === '/tidak-ada' ? 404 : 200,route);
      assert.equal(/<title>[^<]*lekakick[^<]*<\/title>/.test(html),true,`${route}: judul`);
      assert.equal(html.includes('property="og:site_name" content="lekakick"'),true,`${route}: metadata`);
      assert.equal(html.includes('aria-label="lekakick beranda"'),true,`${route}: logo`);
      assert.equal(/garisbola/i.test(html),false,`${route}: merek lama tidak boleh tampil`);
    }
    const placeholder = await (await fetch(base+'/assets/placeholder.svg')).text();
    assert.equal(placeholder.includes('lekakick'),true,'merek ilustrasi');
    assert.equal(/garisbola/i.test(placeholder),false,'ilustrasi tanpa merek lama');
  } finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
});
