// Satu putaran tanpa server: ambil RSS, terbitkan rangkuman bila ada, lalu tulis situs statis.
// Dijalankan terjadwal oleh GitHub Actions (.github/workflows/publish.yml).
import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { NewsStore } from './store.js';
import { DigestStore } from './digest.js';
import { exportSite } from './static.js';

const args = process.argv.slice(2);
const outDir = path.resolve(args.find(arg => !arg.startsWith('--')) ?? 'out');
const skipAi = args.includes('--tanpa-ai');
const dataDir = process.env.DATA_DIR || path.resolve('data');
const dailyLimit = Number(process.env.DIGEST_DAILY_LIMIT || 12);

const store = new NewsStore({dataDir});
await store.init();
const digests = new DigestStore({dataDir, apiKey:skipAi ? undefined : process.env.DEEPSEEK_API_KEY || undefined,
  model:process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro', baseUrl:process.env.DEEPSEEK_BASE_URL || undefined,
  dailyLimit:Number.isInteger(dailyLimit) && dailyLimit >= 0 ? dailyLimit : 12});
await digests.init();
const before = digests.list().map(item => item.id).join(',');
if (!digests.enabled && !skipAi) console.info('Ringkasan AI nonaktif: DEEPSEEK_API_KEY belum diatur');
await digests.run(store.snapshot().items);
const published = digests.list().map(item => item.id).join(',') !== before;
const {pages} = await exportSite(createApp(store, digests), digests.list(), outDir);
console.info(`Situs statis: ${pages} halaman di ${outDir}; ${published ? 'ada artikel baru' : 'tidak ada artikel baru'}`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=${published}\n`);
// RSS memakai socket keep-alive; jangan tunggu sampai habis.
process.exit(0);
