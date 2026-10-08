import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../src/news.js';

test('parser menolak DTD, XML rusak, dan input berukuran berlebihan', () => {
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>'));
  assert.throws(() => parseFeed('<rss><channel></rss>'));
  assert.throws(() => parseFeed('x'.repeat(1_500_001)));
});
test('RSS menghapus duplikat dan menolak host palsu serta tanggal rusak', () => {
  const row = (url: string, pubDate='Thu, 08 Oct 2026 12:00:00 +0700') => `<item><title>Timnas Indonesia</title><link>${url}</link><pubDate>${pubDate}</pubDate><enclosure url="https://evil.example/photo.jpg"/></item>`;
  const rss = `<rss><channel>${row('https://www.antaranews.com/berita/1/test')}${row('https://www.antaranews.com/berita/1/test')}${row('https://www.antaranews.com.evil.example/berita/2/test')}${row('https://www.antaranews.com/berita/3/test','invalid')}</channel></rss>`;
  const items = parseFeed(rss);
  assert.equal(items.length,1);
  assert.equal(items[0].image,'');
});
