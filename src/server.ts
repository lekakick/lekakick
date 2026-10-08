import { createApp } from './app.js';
import { NewsStore } from './store.js';
import path from 'node:path';

const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT tidak valid');
const store = new NewsStore({dataDir:process.env.DATA_DIR || path.resolve('data')});
await store.init();
const app = createApp(store);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.info(`GarisBola siap di port ${port}; ${store.snapshot().items.length} berita dari RSS`);
});
server.requestTimeout = 15_000;
server.headersTimeout = 20_000;
const refresh = setInterval(() => {
  void store.refresh().catch(error => console.error('Pembaruan RSS gagal:', error.message));
}, 10 * 60 * 1000);
refresh.unref();
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    clearInterval(refresh);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
