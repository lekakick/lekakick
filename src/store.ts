import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { parseFeed, type Article } from './news.js';
import { FEEDS as CONFIGURED_FEEDS, SOURCES, type Feed, type SourceId } from './sources.js';
import { resolveRefreshInterval } from './scheduler.js';

// Compatibility for consumers that used the original list of URL strings.
export const FEEDS = CONFIGURED_FEEDS.map(feed => feed.url);
// Allows all feeds plus JSON escaping and the bounded normalized archive.
export const MAX_CACHE_BYTES = CONFIGURED_FEEDS.length * 1_500_000 * 6 + 12_000_000;
interface CachedFeed { url: string; xml: string; updatedAt: string; etag?: string; lastModified?: string }
const validator = (value: unknown): string | undefined => typeof value === 'string' && value.length <= 2000 && !/[\r\n]/.test(value) ? value : undefined;
function failureCode(error: unknown): string {
  if (!(error instanceof Error)) return 'Pembaruan gagal';
  if (/^RSS HTTP [1-5]\d{2}$/.test(error.message)) return error.message;
  if (['304 tanpa cache', 'RSS melebihi batas ukuran', 'RSS tidak berisi berita valid', 'Format RSS tidak valid', 'RSS tidak memiliki channel'].includes(error.message)) return error.message;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'TIMEOUT';
  const code = (error.cause as {code?: unknown} | undefined)?.code;
  if (typeof code === 'string' && ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) return code;
  return 'Pembaruan gagal';
}
export interface SourceStatus {
  id: SourceId; name: string; homepage: string; status: 'ok' | 'partial' | 'error';
  articleCount: number; feedCount: number; healthyFeeds: number;
  lastSuccessAt: string | null; lastAttemptAt: string | null;
}
export interface Snapshot {
  items: Article[]; updatedAt: string | null; lastAttemptAt: string | null; degraded: boolean;
  sources?: SourceStatus[]; revision?: string; refreshIntervalMs?: number;
}
async function fetchFeed(url: string, cached: CachedFeed | undefined, request: typeof fetch): Promise<Omit<CachedFeed, 'updatedAt'>> {
  const signal = AbortSignal.timeout(12_000);
  try { return await fetchFeedOnce(url, cached, request, signal); }
  catch (error) {
    const code = error instanceof Error ? (error.cause as {code?: unknown} | undefined)?.code : undefined;
    if (signal.aborted || typeof code !== 'string' || !['ECONNRESET', 'UND_ERR_SOCKET', 'EAI_AGAIN'].includes(code)) throw error;
    await delay(250, undefined, { signal });
    return fetchFeedOnce(url, cached, request, signal);
  }
}
async function fetchFeedOnce(url: string, cached: CachedFeed | undefined, request: typeof fetch, signal: AbortSignal): Promise<Omit<CachedFeed, 'updatedAt'>> {
  const headers: Record<string, string> = { 'User-Agent': 'lekakick/1.0 RSS Reader', Accept: 'application/rss+xml, application/xml, text/xml' };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
  const response = await request(url, { signal, redirect: 'error', headers });
  const etag = validator(response.headers.get('etag'));
  const lastModified = validator(response.headers.get('last-modified'));
  if (response.status === 304) {
    if (!cached) throw new Error('304 tanpa cache');
    return { ...cached, etag: etag ?? cached.etag, lastModified: lastModified ?? cached.lastModified };
  }
  if (!response.ok || !response.body) throw new Error(`RSS HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 1_500_000) throw new Error('RSS melebihi batas ukuran');
    chunks.push(chunk);
  }
  return { url, xml: Buffer.concat(chunks).toString('utf8'), etag, lastModified };
}
// Cache is untrusted too: pass archived fields through the same publisher rules.
function restoreArticle(value: unknown): Article | undefined {
  if (!value || typeof value !== 'object') return;
  const item = value as Record<string, unknown>;
  if (!SOURCES.some(source => source.id === item.sourceId)) return;
  const keys = ['title', 'url', 'publishedAt', 'excerpt', 'image', 'imageCredit'] as const;
  if (keys.some(key => typeof item[key] !== 'string' || (item[key] as string).length > 5000)) return;
  const escape = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  try {
    const xml = `<rss><channel><item><title>${escape(item.title)}</title><link>${escape(item.url)}</link><pubDate>${escape(item.publishedAt)}</pubDate><description>${escape(item.excerpt)}</description><media:content url="${escape(item.image)}"><media:description>${escape(item.imageCredit)}</media:description></media:content></item></channel></rss>`;
    const article = parseFeed(xml, item.sourceId as SourceId)[0];
    return article?.id === item.id ? article : undefined;
  } catch { return; }
}
const latest = (dates: string[]) => dates.sort().at(-1) ?? null;
const revisionFor = (items: Article[]) => createHash('sha256').update(JSON.stringify(items)).digest('hex');
export class NewsStore {
  private cached = new Map<string, CachedFeed>();
  private archive = new Map<string, Article>();
  private state: Snapshot;
  private pending: Promise<void> | null = null;
  private readonly dataDir: string;
  private readonly feeds: readonly Feed[];
  private readonly fetchXml?: (url: string) => Promise<string>;
  private readonly request: typeof fetch;
  private readonly now: () => Date;
  constructor(options: { dataDir: string; feeds?: readonly Feed[]; fetchXml?: (url: string) => Promise<string>; fetch?: typeof fetch; now?: () => Date; refreshIntervalMs?: number }) {
    this.dataDir = options.dataDir;
    this.feeds = options.feeds ?? CONFIGURED_FEEDS;
    if (this.feeds.some(feed => !CONFIGURED_FEEDS.some(known => known.url === feed.url && known.sourceId === feed.sourceId))) throw new Error('Feed tidak diizinkan');
    this.fetchXml = options.fetchXml;
    this.request = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.state = { items: [], updatedAt: null, lastAttemptAt: null, degraded: true, sources: [], revision: revisionFor([]), refreshIntervalMs: resolveRefreshInterval(options.refreshIntervalMs) };
    this.rebuild(new Set());
  }
  snapshot(): Snapshot { return this.state; }
  private rebuild(healthy: Set<string>): void {
    const items = new Map<string, Article>(this.archive);
    // The persisted archive is the last accepted value of each article, not a
    // lower-priority feed. Cached XML may bootstrap missing IDs (including v1),
    // but only a successful poll may replace an archived value. This also keeps
    // legacy v2 archives safe on restart, without inventing missing provenance.
    const orderedFeeds = [...this.feeds].sort((a, b) => (this.cached.get(a.url)?.updatedAt ?? '').localeCompare(this.cached.get(b.url)?.updatedAt ?? '') || a.url.localeCompare(b.url));
    const cachedItems = new Map<string, Article>();
    const freshItems = new Map<string, Article>();
    for (const config of orderedFeeds) {
      const feed = this.cached.get(config.url);
      if (!feed) continue;
      for (const article of parseFeed(feed.xml, config.sourceId)) {
        cachedItems.set(article.id, article);
        if (healthy.has(config.url)) freshItems.set(article.id, article);
      }
    }
    for (const [id, article] of cachedItems) if (!items.has(id)) items.set(id, article);
    // Equal poll times retain the deterministic URL tie-break above.
    for (const [id, article] of freshItems) items.set(id, article);
    const all = [...items.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
    // Reserve up to 100 actual articles per publisher, then fill newest-first.
    const retained = new Set(SOURCES.flatMap(source => all.filter(item => item.sourceId === source.id).slice(0, 100).map(item => item.id)));
    for (const item of all) { if (retained.size >= 1200) break; retained.add(item.id); }
    const sorted = all.filter(item => retained.has(item.id));
    this.archive = new Map(sorted.map(item => [item.id, item]));
    const sources = SOURCES.filter(source => this.feeds.some(feed => feed.sourceId === source.id)).map(source => {
      const feeds = this.feeds.filter(feed => feed.sourceId === source.id);
      const healthyFeeds = feeds.filter(feed => healthy.has(feed.url)).length;
      return {
        id: source.id, name: source.name, homepage: source.homepage,
        status: healthyFeeds === feeds.length ? 'ok' as const : healthyFeeds ? 'partial' as const : 'error' as const,
        articleCount: sorted.filter(item => item.sourceId === source.id).length, feedCount: feeds.length, healthyFeeds,
        lastSuccessAt: latest(feeds.flatMap(feed => this.cached.get(feed.url)?.updatedAt ?? [])), lastAttemptAt: this.state.lastAttemptAt,
      };
    });
    this.state = { ...this.state, items: sorted, sources, revision: revisionFor(sorted), updatedAt: latest([...this.cached.values()].map(feed => feed.updatedAt)), degraded: healthy.size !== this.feeds.length };
  }
  /**
   * Muat cache lalu ambil RSS. Dengan waitForRefresh=false dan cache tersedia, pemeriksaan RSS
   * berjalan di belakang agar server bisa langsung melayani pembaca setelah restart.
   */
  async init(options: { waitForRefresh?: boolean } = {}): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const filename = path.join(this.dataDir, 'feeds.json');
      if ((await stat(filename)).size > MAX_CACHE_BYTES) throw new Error('Cache terlalu besar');
      const content = await readFile(filename, 'utf8');
      if (Buffer.byteLength(content) > MAX_CACHE_BYTES) throw new Error('Cache terlalu besar');
      const saved = JSON.parse(content);
      if (![1, 2].includes(saved.version) || !Array.isArray(saved.feeds)) throw new Error('Cache tidak valid');
      for (const feed of saved.feeds) {
        try {
          const config = this.feeds.find(config => config.url === feed?.url);
          if (config && typeof feed.xml === 'string' && Number.isFinite(Date.parse(feed.updatedAt))) {
            if (!parseFeed(feed.xml, config.sourceId).length) continue;
            this.cached.set(feed.url, { url: feed.url, xml: feed.xml, updatedAt: feed.updatedAt, etag: validator(feed.etag), lastModified: validator(feed.lastModified) });
          }
        } catch { /* Isolate corrupt feed entries; later publishers still resume. */ }
      }
      for (const item of Array.isArray(saved.archive) ? saved.archive.slice(0, 1200) : []) {
        const article = restoreArticle(item);
        if (article && this.feeds.some(feed => feed.sourceId === article.sourceId)) this.archive.set(article.id, article);
      }
      this.rebuild(new Set());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Cache RSS diabaikan');
    }
    const refreshing = this.refresh();
    if ((options.waitForRefresh ?? true) || !this.state.items.length) await refreshing;
    else refreshing.catch(() => console.error('Pembaruan RSS awal gagal'));
  }
  refresh(): Promise<void> {
    if (!this.pending) this.pending = this.performRefresh().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async performRefresh(): Promise<void> {
    const lastAttemptAt = this.now().toISOString();
    this.state = { ...this.state, lastAttemptAt, sources: this.state.sources?.map(source => ({ ...source, lastAttemptAt })) };
    const healthy = new Set<string>();
    const results = await Promise.allSettled(this.feeds.map(async feed => {
      const result = this.fetchXml ? { url: feed.url, xml: await this.fetchXml(feed.url) } : await fetchFeed(feed.url, this.cached.get(feed.url), this.request);
      if (!parseFeed(result.xml, feed.sourceId).length) throw new Error('RSS tidak berisi berita valid');
      this.cached.set(feed.url, { ...result, updatedAt: this.now().toISOString() });
      healthy.add(feed.url);
    }));
    results.forEach((result, index) => {
      const feed = this.feeds[index]!;
      if (result.status === 'rejected') console.warn(`RSS gagal ${feed.sourceId} ${feed.url}: ${failureCode(result.reason)}`);
    });
    const completedAt = this.now().toISOString();
    for (const url of healthy) this.cached.get(url)!.updatedAt = completedAt;
    this.rebuild(healthy);
    const filename = path.join(this.dataDir, 'feeds.json');
    try {
      const content = JSON.stringify({ version: 2, feeds: [...this.cached.values()], archive: [...this.archive.values()] });
      if (Buffer.byteLength(content) > MAX_CACHE_BYTES) throw new Error('Cache terlalu besar');
      await writeFile(`${filename}.tmp`, content, { mode: 0o600 });
      await rename(`${filename}.tmp`, filename);
    } catch { console.error('Gagal menyimpan cache RSS'); }
    console.info(`RSS ${this.state.sources?.map(source => `${source.id}=${source.articleCount}(${source.healthyFeeds}/${source.feedCount})`).join(' ')}`);
  }
}
