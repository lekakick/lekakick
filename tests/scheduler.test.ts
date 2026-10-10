import test from 'node:test';
import assert from 'node:assert/strict';
import { NewsStore } from '../src/store.js';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';

test('server memakai interval env untuk refresh otomatis dan shutdown SIGTERM', async () => {
  const dir = await mkdtemp(`${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/scheduler-server-`);
  const preload = `${dir}/preload.mjs`;
  await writeFile(preload, `
    globalThis.fetch = async () => new Response('<rss><channel><item><title>Berita</title><link>https://www.antaranews.com/berita/1/test</link><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate></item></channel></rss>');
    const native = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => native(callback, delay === 1000 ? 5 : delay, ...args);
  `);
  const child = spawn(process.execPath, ['--import', 'tsx', '--import', preload, 'src/server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: '49381', DATA_DIR: dir, REFRESH_INTERVAL_MS: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let timedOut = false;
  const limit = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 2500);
  child.stdout.on('data', data => { output += data; if ((output.match(/RSS antara=/g) ?? []).length >= 2) child.kill('SIGTERM'); });
  child.stderr.on('data', data => { output += data; });
  try {
    const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
    assert.equal(timedOut, false, output);
    assert.equal(code, 0, output);
    assert.ok((output.match(/RSS antara=/g) ?? []).length >= 2, output);
  } finally { clearTimeout(limit); child.kill('SIGKILL'); await rm(dir, { recursive: true, force: true }); }
});

test('scheduler default 5 menit, interval tervalidasi, tanpa overlap dan berhenti bersih', async () => {
  const api = await import('../src/scheduler.js').catch(() => ({} as any));
  assert.equal(typeof api.startRefreshScheduler, 'function', 'scheduler tersedia');
  assert.equal(api.resolveRefreshInterval(), 300_000);
  assert.equal(api.resolveRefreshInterval('1000'), 1000);
  for (const invalid of ['999', 'NaN', '', '1000.5', 'Infinity', '-10', '2147483648']) assert.throws(() => api.resolveRefreshInterval(invalid));
  let scheduled: { callback: () => void; delay: number } | undefined;
  let releases: (() => void)[] = []; let attempts = 0; let errors = 0;
  const timers = {
    setTimeout(callback: () => void, delay: number) { assert.equal(scheduled, undefined); scheduled = { callback, delay }; return {}; },
    clearTimeout() { scheduled = undefined; },
  };
  const scheduler = api.startRefreshScheduler({ refresh: async () => { attempts++; await new Promise<void>(resolve => releases.push(resolve)); if (attempts === 1) throw Error('upstream'); } }, { intervalMs: 1000, timers, onError: () => { errors++; } });
  const tick = async () => { const callback = scheduled!.callback; scheduled = undefined; callback(); await new Promise(resolve => setImmediate(resolve)); };
  assert.equal(scheduled!.delay, 1000);
  await tick();
  assert.equal(attempts, 1);
  assert.equal(scheduled, undefined, 'jangan menjadwalkan timer saat poll berlangsung');
  releases.shift()!(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors, 1);
  assert.equal(scheduled!.delay, 1000, 'gagal tetap menjadwalkan ulang');
  await tick();
  let stopped = false;
  const stop = scheduler.stop().then(() => { stopped = true; });
  assert.equal(stopped, false);
  releases.shift()!(); await stop;
  assert.equal(scheduled, undefined);
  assert.equal(attempts, 2);
  const store = new NewsStore({ dataDir: '/unused', refreshIntervalMs: 1000 });
  assert.equal(store.snapshot().refreshIntervalMs, 1000);
  assert.throws(() => new NewsStore({ dataDir: '/unused', refreshIntervalMs: 50 }));
});
