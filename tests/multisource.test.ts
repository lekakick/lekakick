import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseFeed } from '../src/news.js';

const rss = (items: string) => `<rss><channel>${items}</channel></rss>`;
const row = (url: string, media = '', description = 'Kabar &amp; pertandingan.') => `<item><title>Berita sepak bola</title><link>${url}</link><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate><description><![CDATA[${description}]]></description>${media}</item>`;

test('setiap publisher mempertahankan identitas, waktu, gambar dan kredit RSS', () => {
  const cases = [
    ['antara', 'ANTARA News', 'https://www.antaranews.com/berita/123/a', '<media:content url="https://cdn.antaranews.com/a.jpg"><media:description>ANTARA/Budi</media:description></media:content>', 'ANTARA/Budi'],
    ['detik', 'detikSport', 'https://sport.detik.com/sepakbola/liga-indonesia/d-123/a', '<enclosure url="https://akcdn.detik.net.id/a.jpg"/>', 'Foto: detikSport (via RSS)'],
    ['bola', 'Bola.com', 'https://www.bola.com/indonesia/read/123/a', '<media:content url="https://cdn0-production-images-kly.akamaized.net/a.jpg" copyright="Dok. klub" attribution="Dok. klub"/>', 'Dok. klub'],
    ['tempo', 'Tempo', 'https://www.tempo.co/sepakbola/a-123', '<media:thumbnail url="https://images-tm.tempo.co/a.jpg"/>', 'Foto: Tempo (via RSS)'],
  ] as const;
  for (const [id, name, url, media, credit] of cases) {
    const items = parseFeed(rss(row(url, media)), id);
    assert.equal(items.length, 1, id);
    assert.equal(items[0].sourceId, id);
    assert.equal(items[0].source, name);
    assert.equal(items[0].imageCredit, credit);
    assert.ok(items[0].image.startsWith('https://'));
    assert.equal(items[0].publishedAt, '2026-10-08T05:00:00.000Z');
    assert.equal(items[0].excerpt, 'Kabar & pertandingan.');
  }
  const url = 'https://www.antaranews.com/berita/123/a?utm_source=legacy';
  assert.equal(parseFeed(rss(row(url)))[0].id, createHash('sha256').update(url).digest('hex').slice(0, 16));
});

test('gambar fallback aman, kredit media jamak, URL canonical dan spoof ditolak', () => {
  const link = 'https://sport.detik.com/sepakbola/d-123/a';
  const parsed = parseFeed(rss(row(`${link}?utm_source=x&amp;fbclid=y`, '<media:content url="https://evil.example/a.jpg"/>', `<img src="https://akcdn.detik.net.id/fallback.jpg?a=1&amp;b=2"/><script>jahat()</script><b>${'a'.repeat(400)}</b>`) + row(link)), 'detik');
  assert.equal(parsed.length, 1);
  const image = parseFeed(rss(row(link, '<media:content url="https://evil.example/a.jpg"/>', '<img src="https://akcdn.detik.net.id/fallback.jpg?a=1&amp;b=2"/>Ringkasan')), 'detik')[0];
  assert.equal(image.image, 'https://akcdn.detik.net.id/fallback.jpg?a=1&b=2');
  assert.equal(image.excerpt, 'Ringkasan');
  const multiple = parseFeed(rss(row('https://www.bola.com/dunia/read/1/a', '<media:content url="http://evil.test/a"/><media:content url="https://cdn1-production-images-kly.akamaized.net/a.jpg" attribution="Kredit asli"/>')), 'bola')[0];
  assert.equal(multiple.imageCredit, 'Kredit asli');
  assert.equal(parseFeed(rss(row(link, '', 'a'.repeat(500))), 'detik')[0].excerpt.length, 360);
  for (const bad of [
    'http://sport.detik.com/sepakbola/a', 'https://sport.detik.com.evil.test/sepakbola/a',
    'https://user@sport.detik.com/sepakbola/a', 'https://sport.detik.com:443/sepakbola/a',
    'https://sport.detik.com:444/sepakbola/a', 'https://sport.detik.com/other/a',
    'https://sport.detik.com/sepakbola/../other/a', 'https://sport.detik.com/sepakbola/%2f..%2fother/a',
    'https://sport.detik.com/sepakbola/a%5cb', 'https://www.tempo.co/sepakbola/a',
  ]) assert.equal(parseFeed(rss(row(bad)), 'detik').length, 0, bad);
});
