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
