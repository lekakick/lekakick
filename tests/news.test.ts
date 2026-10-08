import test from 'node:test';
import assert from 'node:assert/strict';

test('RSS menjadi berita beratribusi, tanpa HTML mentah atau URL berbahaya', async () => {
  const { parseFeed } = await import('../src/news.js');
  const xml = `<rss><channel><item><title>Timnas Indonesia &amp; Garuda</title><link>https://www.antaranews.com/berita/123/timnas</link><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate><description><![CDATA[<img src="x" />Kabar <b>Timnas</b> terbaru.]]></description><media:content url="https://cdn.antaranews.com/cache/800x533/timnas.jpg"><media:description>Foto: ANTARA</media:description></media:content></item><item><title>Berbahaya</title><link>javascript:alert(1)</link><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate></item></channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Timnas Indonesia & Garuda');
  assert.equal(items[0].excerpt, 'Kabar Timnas terbaru.');
  assert.equal(items[0].category, 'timnas');
  assert.equal(items[0].source, 'ANTARA News');
  assert.equal(items[0].imageCredit, 'Foto: ANTARA');
  assert.equal(items[0].url, 'https://www.antaranews.com/berita/123/timnas');
  assert.match(items[0].id, /^[a-f0-9]{16}$/);
});
