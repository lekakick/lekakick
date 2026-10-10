import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
const feed = `<rss><channel><item><title>Timnas Indonesia berlatih</title><link>https://www.antaranews.com/berita/555/latihan</link><description>Persiapan pertandingan.</description><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate></item></channel></rss>`;

test('cache RSS bertahan setelah restart dan tetap tersedia saat sumber gagal', async () => {
  const { NewsStore } = await import('../src/store.js');
  const dir = await mkdtemp(`${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/garisbola-test-`);
  try {
    const { FEEDS } = await import('../src/sources.js');
    const feeds = FEEDS.filter(f => f.sourceId === 'antara');
    const store = new NewsStore({dataDir: dir, feeds, fetchXml: async () => feed});
    await store.init();
    assert.equal(store.snapshot().items.length, 1);
    assert.ok(store.snapshot().updatedAt);
    assert.equal(store.snapshot().degraded, false);
    const offline = new NewsStore({dataDir: dir, feeds, fetchXml: async () => { throw new Error('offline'); }});
    await offline.init();
    assert.equal(offline.snapshot().items.length, 1);
    assert.equal(offline.snapshot().degraded, true);
    assert.equal(offline.snapshot().updatedAt, store.snapshot().updatedAt);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('restart dengan cache langsung siap tanpa menunggu RSS, lalu memperbarui di belakang', async () => {
  const { NewsStore } = await import('../src/store.js');
  const dir = await mkdtemp(`${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/garisbola-test-`);
  try {
    const { FEEDS } = await import('../src/sources.js');
    const feeds = FEEDS.filter(f => f.sourceId === 'antara');
    await new NewsStore({dataDir: dir, feeds, fetchXml: async () => feed}).init();
    let release!: () => void;
    const slow = new Promise<void>(resolve => { release = resolve; });
    const restarted = new NewsStore({dataDir: dir, feeds, fetchXml: async () => { await slow; return feed; }});
    await restarted.init({waitForRefresh: false});
    assert.equal(restarted.snapshot().items.length, 1, 'cache langsung tersedia');
    const before = restarted.snapshot().lastAttemptAt;
    release();
    await restarted.refresh();
    assert.ok(restarted.snapshot().lastAttemptAt, 'pemeriksaan RSS tetap berjalan');
    assert.notEqual(before, undefined);
    const empty = await mkdtemp(`${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/garisbola-test-`);
    const fresh = new NewsStore({dataDir: empty, feeds, fetchXml: async () => feed});
    await fresh.init({waitForRefresh: false});
    assert.equal(fresh.snapshot().items.length, 1, 'tanpa cache tetap menunggu RSS pertama');
    await rm(empty, {recursive:true, force:true});
  } finally { await rm(dir, {recursive:true, force:true}); }
});
