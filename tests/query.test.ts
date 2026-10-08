import test from 'node:test';
import assert from 'node:assert/strict';
import type { Article } from '../src/news.js';

test('pencarian menggabungkan kategori dan teks, lalu membatasi halaman dengan benar', async () => {
  const { queryArticles } = await import('../src/news.js');
  const items = Array.from({length: 25}, (_, i) => ({ id: String(i), title: `TIMNAS Garuda ${i}`, excerpt: 'Kabar lapangan', category: i === 24 ? 'internasional' : 'timnas', publishedAt: '2026-10-08T00:00:00Z' })) as Article[];
  const result = queryArticles(items, {category: 'timnas', q: 'garuda', page: '2'});
  assert.equal(result.total, 24);
  assert.equal(result.pages, 2);
  assert.equal(result.page, 2);
  assert.equal(result.items.length, 12);
  assert.equal(result.items[0].id, '12');
  assert.equal(queryArticles(items, {q:'tidak ditemukan'}).total, 0);
  assert.equal(queryArticles(items, {page:'999999'}).page, 3);
  assert.equal(queryArticles(items, {page:'-2', category:'<script>'}).category, 'semua');
  assert.equal(queryArticles(items, {page:'-2'}).page, 1);
});
