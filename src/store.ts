import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { parseFeed, type Article } from './news.js';

export const FEEDS = [
  'https://www.antaranews.com/rss/sepakbola.xml',
  'https://www.antaranews.com/rss/sepakbola-liga-indonesia.xml',
  'https://www.antaranews.com/rss/sepakbola-internasional.xml',
  'https://www.antaranews.com/rss/sepakbola-liga-inggris-premier.xml',
];
interface CachedFeed { url: string; xml: string; updatedAt: string }
export interface Snapshot { items: Article[]; updatedAt: string | null; lastAttemptAt: string | null; degraded: boolean }

async function fetchXml(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000), redirect: 'error',
    headers: { 'User-Agent': 'lekakick/1.0 RSS Reader', Accept: 'application/rss+xml, application/xml, text/xml' },
  });
  if (!response.ok || !response.body) throw new Error(`RSS HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 1_500_000) throw new Error('RSS melebihi batas ukuran');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class NewsStore {
  private cached = new Map<string, CachedFeed>();
  private state: Snapshot = { items: [], updatedAt: null, lastAttemptAt: null, degraded: true };
  private pending: Promise<void> | null = null;
  private readonly dataDir: string;
  private readonly fetchXml: (url: string) => Promise<string>;
  constructor(options: {dataDir: string; fetchXml?: (url: string) => Promise<string>}) {
    this.dataDir = options.dataDir;
    this.fetchXml = options.fetchXml ?? fetchXml;
  }
  snapshot(): Snapshot { return this.state; }
  private rebuild(): void {
    const items = new Map<string, Article>();
    for (const feed of this.cached.values()) {
      for (const article of parseFeed(feed.xml)) items.set(article.id, article);
    }
    this.state.items = [...items.values()].sort((a,b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 300);
    this.state.updatedAt = [...this.cached.values()].map(f => f.updatedAt).sort().at(-1) ?? null;
  }
  async init(): Promise<void> {
    await mkdir(this.dataDir, {recursive: true});
    try {
      const content = await readFile(path.join(this.dataDir, 'feeds.json'), 'utf8');
      if (content.length > 7_000_000) throw new Error('Cache terlalu besar');
      const saved = JSON.parse(content);
      if (saved.version !== 1 || !Array.isArray(saved.feeds)) throw new Error('Cache tidak valid');
      for (const feed of saved.feeds) {
        if (FEEDS.includes(feed.url) && typeof feed.xml === 'string' && Number.isFinite(Date.parse(feed.updatedAt))) {
          parseFeed(feed.xml);
          this.cached.set(feed.url, feed);
        }
      }
      this.rebuild();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Cache RSS diabaikan:', (error as Error).message);
    }
    await this.refresh();
  }
  refresh(): Promise<void> {
    if (!this.pending) this.pending = this.performRefresh().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async performRefresh(): Promise<void> {
    this.state.lastAttemptAt = new Date().toISOString();
    const results = await Promise.allSettled(FEEDS.map(async url => {
      const xml = await this.fetchXml(url);
      if (!parseFeed(xml).length) throw new Error('RSS tidak berisi berita valid');
      this.cached.set(url, {url, xml, updatedAt: new Date().toISOString()});
    }));
    this.state.degraded = results.some(result => result.status === 'rejected');
    this.rebuild();
    const filename = path.join(this.dataDir, 'feeds.json');
    try {
      await writeFile(`${filename}.tmp`, JSON.stringify({version:1, feeds:[...this.cached.values()]}), {mode:0o600});
      await rename(`${filename}.tmp`, filename);
    } catch (error) { console.error('Gagal menyimpan cache RSS:', (error as Error).message); }
  }
}
