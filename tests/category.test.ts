import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../src/news.js';

test('kategori Timnas berfokus pada Indonesia, bukan setiap peserta ASEAN Cup', () => {
  const make = (title: string) => `<rss><channel><item><title>${title}</title><link>https://www.antaranews.com/berita/888/berita</link><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate></item></channel></rss>`;
  assert.equal(parseFeed(make('Timnas Laos bersiap untuk ASEAN Cup'))[0].category,'internasional');
  assert.equal(parseFeed(make('Timnas Indonesia bersiap untuk ASEAN Cup'))[0].category,'timnas');
  assert.equal(parseFeed(make('Timnas Putri U17 Indonesia menang'))[0].category,'timnas');
  assert.equal(parseFeed(make('Timnas U-23 Indonesia berlatih'))[0].category,'timnas');
});
