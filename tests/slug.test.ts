import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { parseFeed } from '../src/news.js';
import { createApp } from '../src/app.js';

const titles = ['⚽🏆', '足球新闻'];
const xml = `<rss><channel>${titles.map((title, index) => `<item><title>${title}</title><link>https://www.antaranews.com/berita/${index + 1}/unicode</link><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate></item>`).join('')}</channel></rss>`;

for (const title of titles) {
  test(`judul ${title} memakai ID artikel sebagai slug nonkosong yang deterministik`, () => {
    const article = parseFeed(xml).find(item => item.title === title);
    assert.ok(article);
    assert.match(article.id, /^[a-f0-9]{16}$/);
    assert.equal(article.slug, article.id);
    assert.equal(parseFeed(xml).find(item => item.title === title)?.slug, article.slug);
  });
}

test('tautan detail yang dihasilkan untuk judul emoji dan CJK mengembalikan HTTP 200', async () => {
  const items = parseFeed(xml);
  assert.equal(items.length, titles.length);
  const app = createApp({snapshot: () => ({items, updatedAt: null, lastAttemptAt: null, degraded: false})});
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${base}/api/berita?ids=${items.map(item => item.id).join(',')}`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.items.length, titles.length);
    for (const article of data.items) {
      const detail = await fetch(new URL(article.path, base), {redirect: 'manual'});
      assert.equal(detail.status, 200, `Detail ${article.title}: ${article.path}`);
      assert.ok((await detail.text()).includes(`<h1>${article.title}</h1>`));
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
