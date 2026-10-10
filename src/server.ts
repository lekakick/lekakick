import { createApp } from './app.js';
import { NewsStore } from './store.js';
import { DigestStore } from './digest.js';
import { ReportLog } from './reports.js';
import { resolveRefreshInterval, startRefreshScheduler } from './scheduler.js';
import path from 'node:path';

const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT tidak valid');
const refreshIntervalMs = resolveRefreshInterval(process.env.REFRESH_INTERVAL_MS);
const store = new NewsStore({dataDir:process.env.DATA_DIR || path.resolve('data'), refreshIntervalMs});
await store.init();
const dataDir = process.env.DATA_DIR || path.resolve('data');
const dailyLimit = Number(process.env.DIGEST_DAILY_LIMIT || 12);
const digests = new DigestStore({dataDir, apiKey:process.env.DEEPSEEK_API_KEY || undefined, model:process.env.DEEPSEEK_MODEL || 'deepseek-flash', baseUrl:process.env.DEEPSEEK_BASE_URL || undefined,
  dailyLimit:Number.isInteger(dailyLimit) && dailyLimit >= 0 ? dailyLimit : 12});
await digests.init();
const app = createApp(store, digests, new ReportLog(dataDir));
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.info(`lekakick siap di port ${port}; ${store.snapshot().items.length} berita dari RSS`);
});
server.requestTimeout = 15_000;
server.headersTimeout = 20_000;
const refresh = startRefreshScheduler(store, { intervalMs: refreshIntervalMs });
// Rangkuman berjalan terpisah dari RSS agar API AI yang lambat tidak menahan pembaruan berita.
const runDigests = () => void digests.run(store.snapshot().items).catch(() => console.error('Pembuatan ringkasan gagal'));
const digestTimers = digests.enabled ? [setTimeout(runDigests, 60_000), setInterval(runDigests, 20 * 60_000)] : [];
digestTimers.forEach(timer => timer.unref());
console.info(digests.enabled ? `Ringkasan AI aktif (maks ${dailyLimit}/hari)` : 'Ringkasan AI nonaktif: DEEPSEEK_API_KEY belum diatur');
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    digestTimers.forEach(timer => clearTimeout(timer));
    // Allow the 12s RSS deadline plus parsing and atomic cache persistence.
    setTimeout(() => process.exit(1), 20_000).unref();
    void Promise.all([refresh.stop(), new Promise<void>(resolve => server.close(() => resolve()))]).then(() => process.exit(0));
  });
}
