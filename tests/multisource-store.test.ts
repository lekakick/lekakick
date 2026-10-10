import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { NewsStore } from '../src/store.js';
import { FEEDS } from '../src/sources.js';
const feeds = [FEEDS[0], FEEDS[4], FEEDS[5], FEEDS[10]];
const xml = (source: string, n = 1, title = 'Sepak bola') => `<rss><channel><item><title>${title}</title><link>${source === 'antara' ? 'https://www.antaranews.com/berita/' : source === 'detik' ? 'https://sport.detik.com/sepakbola/' : 'https://www.tempo.co/sepakbola/'}${n}/a</link><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate></item></channel></rss>`;
const temp = () => mkdtemp(`${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/multisource-`);

test('migrasi cache v1 mengisolasi XML rusak tanpa kehilangan ID ANTARA', async () => {
  const dir = await temp();
  try {
    const { parseFeed } = await import('../src/news.js');
    const valid = xml('antara');
    await writeFile(`${dir}/feeds.json`, JSON.stringify({ version: 1, feeds: [
      { url: FEEDS[1].url, xml: '<rss>', updatedAt: '2026-10-08T00:00:00Z' },
      { url: FEEDS[0].url, xml: valid, updatedAt: '2026-10-08T00:00:00Z' },
    ] }));
    const store = new NewsStore({ dataDir: dir, feeds: FEEDS.slice(0, 2), fetchXml: async () => { throw Error('offline'); } });
    await store.init();
    assert.equal(store.snapshot().items[0]?.id, parseFeed(valid)[0].id);
    assert.equal(store.snapshot().sources?.[0]?.lastSuccessAt, '2026-10-08T00:00:00Z');
    assert.equal(JSON.parse(await readFile(`${dir}/feeds.json`, 'utf8')).version, 2);
    assert.throws(() => new NewsStore({ dataDir: dir, feeds: [{ url: 'https://evil.test/rss', sourceId: 'antara' }] }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cache v2 Article[] mempertahankan arsip terkoreksi tanpa metadata saat offline', async () => {
  const dir = await temp();
  const { parseFeed } = await import('../src/news.js');
  const corrected = parseFeed(xml('antara', 1, 'Koreksi sebelum migrasi'))[0];
  const next = parseFeed(xml('antara', 2, 'Artikel berikutnya'))[0];
  const configured = FEEDS.slice(0, 2);
  try {
    await writeFile(`${dir}/feeds.json`, JSON.stringify({ version: 2, feeds: [
      { url: configured[0].url, xml: xml('antara', 2, 'Artikel berikutnya'), updatedAt: '2026-10-08T02:00:00Z' },
      { url: configured[1].url, xml: xml('antara', 1, 'Judul awal'), updatedAt: '2026-10-08T00:00:00Z' },
    ], archive: [corrected, next] }));
    const options = { dataDir: dir, feeds: configured, fetchXml: async () => { throw Error('offline'); } };
    const migrated = new NewsStore(options);
    await migrated.init();
    assert.deepEqual(migrated.snapshot().items.find(item => item.id === corrected.id), corrected);
    const saved = JSON.parse(await readFile(`${dir}/feeds.json`, 'utf8'));
    assert.equal(saved.version, 2);
    assert.equal(saved.archive.length, 2);
    assert.deepEqual(saved.archive.find((item: { id: string }) => item.id === corrected.id), corrected);
    const resumed = new NewsStore(options);
    await resumed.init();
    assert.equal(resumed.snapshot().revision, migrated.snapshot().revision);
    assert.deepEqual(resumed.snapshot().items, migrated.snapshot().items);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rotasi feed menyimpan arsip maksimal 1200 dan mempertahankan penerbit lama', async () => {
  const dir = await temp();
  let generation = 0;
  const configured = [FEEDS[0], FEEDS[4]];
  const store = new NewsStore({ dataDir: dir, feeds: configured, fetchXml: async url => {
    if (url === FEEDS[4].url) return xml('detik').replace('08 Oct 2026', '01 Oct 2026');
    const items = Array.from({ length: 400 }, (_, i) => xml('antara', generation * 400 + i).match(/<item>[\s\S]*<\/item>/)![0]);
    return `<rss><channel>${items.join('')}</channel></rss>`;
  } });
  try {
    await store.init();
    generation++; await store.refresh();
    assert.equal(store.snapshot().items.length, 801);
    generation++; await store.refresh();
    assert.equal(store.snapshot().items.length, 1200);
    assert.equal(store.snapshot().sources?.find(s => s.id === 'detik')?.articleCount, 1);
    const resumed = new NewsStore({ dataDir: dir, feeds: configured, fetchXml: async () => { throw Error('offline'); } });
    await resumed.init();
    assert.equal(resumed.snapshot().items.length, 1200);
    assert.equal(resumed.snapshot().revision, store.snapshot().revision);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('conditional GET 304 memakai cache tervalidasi dan mempertahankan revision', async t => {
  const dir = await temp(); let now = 1_800_000_000_000;
  const requests: RequestInit[] = [];
  const fetcher: typeof fetch = async (_url, options) => {
    requests.push(options!);
    return requests.length === 1 ? new Response(xml('antara'), { headers: { ETag: '"rss-v1"', 'Last-Modified': 'Thu, 08 Oct 2026 00:00:00 GMT' } }) : new Response(null, { status: 304 });
  };
  t.mock.method(globalThis, 'fetch', fetcher);
  try {
    const store = new NewsStore({ dataDir: dir, feeds: [FEEDS[0]], fetch: fetcher, now: () => new Date(now) });
    await store.init();
    const first = store.snapshot(); now += 1000;
    await store.refresh();
    assert.equal(requests.length, 2);
    const headers = new Headers(requests[1].headers);
    assert.equal(headers.get('If-None-Match'), '"rss-v1"');
    assert.equal(headers.get('If-Modified-Since'), 'Thu, 08 Oct 2026 00:00:00 GMT');
    assert.equal(requests[0].redirect, 'error');
    assert.ok(requests[0].signal);
    assert.equal(store.snapshot().revision, first.revision);
    assert.equal(store.snapshot().degraded, false);
    assert.notEqual(store.snapshot().updatedAt, first.updatedAt);
    const resumed = new NewsStore({ dataDir: dir, feeds: [FEEDS[0]], fetch: fetcher });
    await resumed.init();
    assert.equal(new Headers(requests[2].headers).get('If-None-Match'), '"rss-v1"');
    assert.equal(resumed.snapshot().degraded, false);
    assert.equal(resumed.snapshot().revision, first.revision);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('304 tanpa cache gagal; stream lebih dari 1.5 MB tidak mengganti cache baik', async () => {
  const dir = await temp(); let step = 0;
  try {
    const store = new NewsStore({ dataDir: dir, feeds: [FEEDS[0]], fetch: async () => {
      step++;
      if (step === 1) return new Response(null, { status: 304 });
      if (step === 2) return new Response(xml('antara'));
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_500_001)); controller.close(); } }));
    } });
    await store.init();
    assert.equal(store.snapshot().degraded, true);
    assert.equal(store.snapshot().updatedAt, null);
    await store.refresh(); const healthy = store.snapshot();
    assert.equal(healthy.items.length, 1);
    await store.refresh();
    assert.equal(store.snapshot().degraded, true);
    assert.equal(store.snapshot().revision, healthy.revision);
    assert.equal(store.snapshot().updatedAt, healthy.updatedAt);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cache disk dibatasi sebelum dibaca dan batas mencakup semua feed', async () => {
  const api = await import('../src/store.js');
  assert.ok(api.MAX_CACHE_BYTES >= FEEDS.length * 1_500_000);
  const dir = await temp();
  const { open } = await import('node:fs/promises');
  const file = await open(`${dir}/feeds.json`, 'w');
  await file.truncate(api.MAX_CACHE_BYTES + 1); await file.close();
  try {
    const store = new NewsStore({ dataDir: dir, feeds: [FEEDS[0]], fetchXml: async () => { throw Error('offline'); } });
    await store.init();
    assert.equal(store.snapshot().items.length, 0);
    const { stat } = await import('node:fs/promises');
    assert.ok((await stat(`${dir}/feeds.json`)).size <= api.MAX_CACHE_BYTES);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('status percobaan langsung berubah saat refresh masih berjalan', async () => {
  const dir = await temp(); let release: (() => void) | undefined; let pending: Promise<void> | undefined;
  const store = new NewsStore({ dataDir: dir, feeds: [FEEDS[0]], fetchXml: async () => { await new Promise<void>(resolve => { release = resolve; }); return xml('antara'); } });
  try {
    pending = store.refresh();
    assert.ok(store.snapshot().lastAttemptAt);
    assert.equal(store.snapshot().sources?.[0]?.lastAttemptAt, store.snapshot().lastAttemptAt);
    release!(); await pending;
  } finally { release?.(); await pending; await rm(dir, { recursive: true, force: true }); }
});

test('feed lama yang gagal tidak menimpa koreksi setelah rotasi dan restart offline', async () => {
  const dir = await temp(); let poll = 0;
  const configured = FEEDS.slice(0, 2);
  const now = () => new Date(1_800_000_000_000 + poll * 1000);
  const store = new NewsStore({ dataDir: dir, feeds: configured, now, fetchXml: async url => {
    if (poll && url === FEEDS[1].url) throw Error('offline');
    return poll >= 2 ? xml('antara', 2, 'Artikel berikutnya') : xml('antara', 1, poll ? 'Judul koreksi' : 'Judul awal');
  } });
  try {
    await store.init();
    const original = store.snapshot().items[0];
    poll++; await store.refresh();
    assert.equal(store.snapshot().items[0].title, 'Judul koreksi');
    assert.equal(store.snapshot().items[0].id, original.id, 'bookmark tetap memakai ID awal');
    poll++; await store.refresh();
    const rotated = store.snapshot();
    assert.equal(rotated.items.find(item => item.id === original.id)?.title, 'Judul koreksi');
    assert.equal(rotated.items.length, 2);
    assert.equal(rotated.sources?.[0].status, 'partial');
    poll++; await store.refresh();
    assert.equal(store.snapshot().revision, rotated.revision, 'waktu polling bukan revisi konten');
    const saved = JSON.parse(await readFile(`${dir}/feeds.json`, 'utf8'));
    assert.equal(saved.archive.find((item: { id: string }) => item.id === original.id)?.title, 'Judul koreksi');
    let online = false;
    const resumed = new NewsStore({ dataDir: dir, feeds: configured, now, fetchXml: async url => {
      if (!online || url === FEEDS[1].url) throw Error('offline');
      return xml('antara', 1, 'Koreksi terbaru');
    } });
    poll++; await resumed.init();
    assert.equal(resumed.snapshot().items.find(item => item.id === original.id)?.title, 'Judul koreksi');
    assert.equal(resumed.snapshot().revision, rotated.revision);
    assert.equal(resumed.snapshot().degraded, true);
    online = true; poll++; await resumed.refresh();
    assert.equal(resumed.snapshot().items.find(item => item.id === original.id)?.title, 'Koreksi terbaru');
    assert.notEqual(resumed.snapshot().revision, rotated.revision, 'arsip masih menerima koreksi baru');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('store dedupe publisher, isolasi kegagalan, revision konten saja, dan coalescing', async () => {
  const dir = await temp();
  let now = 1_800_000_000_000;
  let fail = ''; let title = 'Sepak bola'; let calls = 0;
  const store = new NewsStore({ dataDir: dir, feeds, now: () => new Date(now), fetchXml: async url => {
    calls++;
    if (url === fail) throw new Error('secret upstream error');
    return xml(feeds.find(f => f.url === url)!.sourceId, 1, title);
  } });
  try {
    await store.init();
    const first = store.snapshot();
    assert.equal(first.items.length, 3);
    assert.equal(first.degraded, false);
    assert.equal(first.sources?.find(s => s.id === 'detik')?.healthyFeeds, 2);
    assert.ok(first.revision);
    now += 1000;
    const p = store.refresh();
    assert.equal(p, store.refresh());
    await p;
    assert.equal(calls, 8);
    assert.equal(store.snapshot().revision, first.revision);
    assert.notEqual(store.snapshot().updatedAt, first.updatedAt);
    now += 1000; fail = feeds[1].url;
    await store.refresh();
    const partial = store.snapshot();
    assert.equal(partial.sources?.find(s => s.id === 'detik')?.status, 'partial');
    assert.equal(partial.sources?.find(s => s.id === 'detik')?.articleCount, 1);
    assert.equal(partial.degraded, true);
    assert.equal(partial.items.length, 3);
    assert.ok(!JSON.stringify(partial).includes('secret'));
    title = 'Berita diperbarui'; now += 1000;
    await store.refresh();
    assert.notEqual(store.snapshot().revision, first.revision);
    const restart = new NewsStore({ dataDir: dir, feeds, fetchXml: async () => { throw Error('offline'); } });
    await restart.init();
    assert.equal(restart.snapshot().items.length, 3);
    assert.equal(restart.snapshot().revision, store.snapshot().revision);
    assert.equal(restart.snapshot().updatedAt, store.snapshot().updatedAt);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
