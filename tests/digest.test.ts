import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DigestStore, findClusters, validateDraft } from '../src/digest.js';
import { createApp } from '../src/app.js';
import type { Article } from '../src/news.js';

const now = new Date('2026-10-10T12:00:00.000Z');
const article = (id: string, sourceId: Article['sourceId'], source: string, title: string, excerpt: string, hoursAgo = 1): Article => ({
  id: id.padEnd(16, '0'), slug: 's', title, excerpt, category: 'internasional', url: `https://example.com/${id}`,
  image: sourceId === 'detik' ? 'https://akcdn.detik.net.id/foto.jpg' : '', imageCredit: '', source, sourceId,
  publishedAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
});
const items = [
  article('a1', 'detik', 'detikSport', 'Timnas Turki Pecat Vincenzo Montella', 'Federasi sepak bola Turki resmi memecat Vincenzo Montella dari kursi pelatih tim nasional setelah rentetan hasil buruk. Keputusan diumumkan federasi melalui laman resmi mereka.'),
  article('a2', 'antara', 'ANTARA News', 'TFF pecat Vincenzo Montella sebagai pelatih timnas Turki', 'TFF memutuskan memecat Vincenzo Montella dari jabatan pelatih timnas Turki menyusul hasil buruk dalam beberapa laga. Pengganti Montella belum diumumkan oleh federasi.'),
  article('a3', 'bola', 'Bola.com', 'Link Live Streaming Liga Italia: Inter Milan Vs Parma', 'Saksikan siaran langsung Inter Milan melawan Parma di Liga Italia malam ini melalui tautan berikut ini.'),
  article('a4', 'tempo', 'Tempo', 'Chelsea menang besar atas Bournemouth', 'Chelsea menang 5-1 atas Bournemouth berkat dua gol Jordan Henderson di Stamford Bridge pada akhir pekan.'),
];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const words = (n: number, seed = 0) => Array.from({length: n}, (_, i) => `kata${LETTERS[(i + seed) % 26]}${LETTERS[Math.floor((i + seed) / 26) % 26]}`).join(' ');
const goodDraft = {
  title: 'Turki Resmi Berpisah dengan Vincenzo Montella',
  dek: 'Federasi Turki mengakhiri kerja sama dengan pelatih asal Italia itu setelah performa tim terus menurun.',
  paragraphs: [words(60), words(55), words(50)],
  analysis: [words(50, 200), words(45, 300)],
};
const deepseek = (content: unknown, calls: unknown[] = []) => (async (_url: string | URL | Request, init?: RequestInit) => {
  calls.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(content)}}]}), {status: 200});
}) as typeof fetch;

test('hanya peristiwa dari >=2 penerbit berbeda yang dikelompokkan; jadwal/streaming dilewati', () => {
  const clusters = findClusters(items, {now, used: new Set()});
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0]!.map(item => item.sourceId).sort(), ['antara', 'detik']);
  assert.equal(findClusters(items, {now, used: new Set([items[0]!.id])}).length, 0, 'artikel terpakai tidak dipakai ulang');
  assert.equal(findClusters(items, {now: new Date(now.getTime() + 48 * 3_600_000), used: new Set()}).length, 0, 'berita lama dilewati');
});

test('draf yang menyalin 7 kata beruntun dari sumber, terlalu pendek, atau memuat tautan ditolak', () => {
  const cluster = items.slice(0, 2);
  assert.equal(validateDraft(goodDraft, cluster).title, goodDraft.title);
  const copied = {...goodDraft, paragraphs: [...goodDraft.paragraphs, 'memecat Vincenzo Montella dari kursi pelatih tim nasional setelah rentetan hasil buruk']};
  assert.throws(() => validateDraft(copied, cluster), /Terlalu mirip sumber/);
  assert.throws(() => validateDraft({...goodDraft, paragraphs: ['a', 'b', 'c']}, cluster), /Panjang tidak valid/);
  assert.throws(() => validateDraft({...goodDraft, paragraphs: [...goodDraft.paragraphs, 'baca di https://x.com']}, cluster), /tautan/);
  assert.throws(() => validateDraft('bukan objek', cluster));
  assert.throws(() => validateDraft({...goodDraft, analysis: []}, cluster), /Analisis tidak valid/);
  assert.throws(() => validateDraft({...goodDraft, analysis: [...goodDraft.analysis, 'Montella gagal dalam 7 laga terakhir']}, cluster), /Angka tidak ada di bahan: "7"/);
  const sourced = {...items[0]!, excerpt: `${items[0]!.excerpt} Turki kalah 3-1 pada laga terakhir.`};
  assert.equal(validateDraft({...goodDraft, analysis: [...goodDraft.analysis, 'Kekalahan 3-1 itu menjadi titik balik']}, [sourced, items[1]!]).analysis.length, 3, 'angka dari bahan boleh dipakai');
});

test('ringkasan terbit, tersimpan, tidak diulang, dan tunduk batas harian', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'digest-'));
  try {
    const calls: Record<string, unknown>[] = [];
    const store = new DigestStore({dataDir, apiKey: 'test-key', fetch: deepseek(goodDraft, calls), now: () => now});
    await store.init();
    await store.run(items);
    assert.equal(store.list().length, 1);
    const digest = store.list()[0]!;
    assert.equal(digest.sources.length, 2);
    assert.equal(digest.image, 'https://akcdn.detik.net.id/foto.jpg');
    assert.equal(calls.length, 1);
    assert.match(JSON.stringify(calls[0]), /Vincenzo Montella/);
    await store.run(items);
    assert.equal(calls.length, 1, 'topik yang sama tidak dikirim ulang');
    const reloaded = new DigestStore({dataDir, apiKey: 'test-key', fetch: deepseek(goodDraft), now: () => now});
    await reloaded.init();
    assert.equal(reloaded.list()[0]?.id, digest.id, 'arsip bertahan setelah restart');
    const limited = new DigestStore({dataDir: await mkdtemp(path.join(os.tmpdir(), 'digest-')), apiKey: 'k', dailyLimit: 0, fetch: deepseek(goodDraft, calls), now: () => now});
    await limited.run(items);
    assert.equal(limited.list().length, 0);
    assert.equal(calls.length, 1, 'batas harian 0 tidak memanggil AI');
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});

test('respons AI gagal tidak menerbitkan apa pun, dan tanpa API key tidak memanggil AI', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'digest-'));
  try {
    const failing = new DigestStore({dataDir, apiKey: 'k', now: () => now, fetch: (async () => new Response('err', {status: 500})) as typeof fetch});
    await failing.run(items);
    assert.equal(failing.list().length, 0);
    let called = false;
    const disabled = new DigestStore({dataDir, now: () => now, fetch: (async () => { called = true; return new Response(); }) as typeof fetch});
    await disabled.run(items);
    assert.equal(called, false);
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});

test('halaman rangkuman, sumber, JSON-LD, dan sitemap tampil', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'digest-'));
  const digests = new DigestStore({dataDir, apiKey: 'k', fetch: deepseek(goodDraft), now: () => now});
  await digests.run(items);
  const app = createApp({snapshot: () => ({items, updatedAt: now.toISOString(), lastAttemptAt: now.toISOString(), degraded: false})}, digests);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const digest = digests.list()[0]!;
    const home = await (await fetch(base)).text();
    assert.ok(home.includes(digest.title), 'rangkuman tampil di beranda');
    const list = await (await fetch(`${base}/artikel`)).text();
    assert.ok(list.includes(digest.title));
    const res = await fetch(`${base}/artikel/${digest.id}/${digest.slug}`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.ok(html.includes('https://example.com/a1') && html.includes('https://example.com/a2'), 'semua sumber ditautkan');
    assert.ok(html.includes('"@type":"NewsArticle"') && html.includes('Redaksi lekakick'));
    assert.ok(html.includes('Analisis lekakick') && html.includes(goodDraft.analysis[0]!), 'analisis tampil dengan label');
    assert.equal((await fetch(`${base}/artikel/${digest.id}/salah`, {redirect: 'manual'})).status, 301);
    assert.equal((await fetch(`${base}/artikel/ffffffffffffffff/x`)).status, 404);
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.ok(sitemap.includes(`/artikel/${digest.id}/${digest.slug}</loc>`));
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    await rm(dataDir, {recursive: true, force: true});
  }
});

test('draf yang menyalin sumber diminta ditulis ulang sekali sebelum ditolak', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'digest-'));
  try {
    const copied = {...goodDraft, paragraphs: [...goodDraft.paragraphs, 'memecat Vincenzo Montella dari kursi pelatih tim nasional setelah rentetan hasil buruk']};
    const calls: {messages: {role: string; content: string}[]}[] = [];
    let n = 0;
    const request = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(n++ ? goodDraft : copied)}}]}));
    }) as typeof fetch;
    const store = new DigestStore({dataDir, apiKey: 'k', fetch: request, now: () => now});
    await store.run(items);
    assert.equal(store.list().length, 1);
    assert.equal(calls.length, 2);
    assert.match(calls[1]!.messages.at(-1)!.content, /Tulis ulang/);
  } finally { await rm(dataDir, {recursive: true, force: true}); }
});
