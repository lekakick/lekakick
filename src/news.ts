import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { SOURCES, type Source, type SourceId } from './sources.js';

export const CATEGORIES = [
  { id: 'semua', name: 'Semua Berita' },
  { id: 'timnas', name: 'Timnas' },
  { id: 'liga-indonesia', name: 'Liga Indonesia' },
  { id: 'internasional', name: 'Internasional' },
  { id: 'transfer', name: 'Bursa Transfer' },
] as const;
export type Category = Exclude<typeof CATEGORIES[number]['id'], 'semua'>;
export interface Article {
  id: string; slug: string; title: string; excerpt: string; category: Category;
  url: string; image: string; imageCredit: string; source: string; sourceId?: SourceId; publishedAt: string;
}

function text(value: unknown): string {
  if (value && typeof value === 'object' && '#text' in value) return text(value['#text']);
  if (typeof value !== 'string') return '';
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
function safeUrl(value: unknown, source: Source, image = false): string {
  if (typeof value !== 'string') return '';
  try {
    // Reject explicit ports and ambiguous raw authorities before normalization.
    const authority = /^https:\/\/([^/?#]+)/.exec(value)?.[1];
    if (!authority || /[:@%\\\s]/.test(authority) || /[\\\u0000-\u0020]/.test(value)) return '';
    const url = new URL(value);
    const allowed = image ? source.imageHosts : source.articleHosts;
    if (url.protocol !== 'https:' || !allowed.includes(url.hostname) || url.username || url.password || url.port) return '';
    if (!image && !source.pathPrefixes.some(prefix => url.pathname.startsWith(prefix))) return '';
    if (/%(?:2f|5c|2e|25|00)/i.test(url.pathname)) return '';
    // Keep historical ANTARA URL hashes stable, including query parameters.
    if (!image && source.id !== 'antara') {
      for (const key of [...url.searchParams.keys()]) {
        if (/^utm_|^(fbclid|gclid|dclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
      }
      url.hash = '';
    }
    return url.href;
  } catch { return ''; }
}
function list(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : [value]).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
}
function imageFor(item: Record<string, unknown>, source: Source): { image: string; imageCredit: string } {
  const candidates = [...list(item['media:content']), ...list(item['media:thumbnail']), ...list(item.enclosure)];
  for (const html of [item.description, item['content:encoded']]) {
    if (typeof html !== 'string') continue;
    for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) candidates.push({ '@_url': text(match[1]) });
  }
  for (const media of candidates) {
    const image = safeUrl(media['@_url'], source, true);
    if (!image) continue;
    const credits = [media['media:description'], media['@_copyright'], media['@_attribution'], item['media:copyright'], item['media:description']];
    const imageCredit = [...new Set(credits.map(text).filter(Boolean))].join(' — ').slice(0, 1200) || `Foto: ${source.name} (via RSS)`;
    return { image, imageCredit };
  }
  return { image: '', imageCredit: '' };
}
function categoryFor(value: string): Category {
  if (/transfer|resmi (bergabung|datangkan)|rekrut|pinjaman|kontrak baru/i.test(value)) return 'transfer';
  if (/liga 1|liga 2|super league|persib|persija|persijap|persebaya|arema|psm|borneo fc|madura united|bali united|psis|psim|persis solo|semen padang|psbs|persita/i.test(value)) return 'liga-indonesia';
  if (/timnas\b.{0,32}\bindonesia|garuda|tim nasional\b.{0,32}\bindonesia|emil audero|jay idzes|mees hilgers|ole romeny/i.test(value)) return 'timnas';
  return 'internasional';
}

export interface QueryResult {
  items: Article[]; total: number; page: number; pages: number; category: string; q: string;
}
export function queryArticles(items: Article[], params: { category?: unknown; q?: unknown; page?: unknown }): QueryResult {
  const category = CATEGORIES.some(c => c.id === params.category) ? String(params.category) : 'semua';
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 100) : '';
  const filtered = items.filter(item => (category === 'semua' || item.category === category)
    && `${item.title} ${item.excerpt}`.toLocaleLowerCase('id').includes(q.toLocaleLowerCase('id')));
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const parsedPage = typeof params.page === 'string' && /^\d{1,9}$/.test(params.page) ? Number(params.page) : 1;
  const page = Math.min(pages, Math.max(1, parsedPage));
  return { items: filtered.slice((page - 1) * 12, page * 12), total: filtered.length, page, pages, category, q };
}

export function parseFeed(xml: string, sourceId: SourceId = 'antara'): Article[] {
  const source = SOURCES.find(source => source.id === sourceId);
  if (!source) throw new Error('Sumber RSS tidak valid');
  if (Buffer.byteLength(xml, 'utf8') > 1_500_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error('Format RSS tidak valid');
  }
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, parseTagValue: false });
  const parsed = parser.parse(xml);
  if (!parsed?.rss?.channel) throw new Error('RSS tidak memiliki channel');
  const raw = parsed.rss.channel.item ?? [];
  const rows = Array.isArray(raw) ? raw : [raw];
  const articles = new Map<string, Article>();
  for (const item of rows.slice(0, 400)) {
    const title = text(item.title).slice(0, 300);
    const url = safeUrl(item.link, source);
    const timestamp = Date.parse(item.pubDate);
    if (!title || !url || !Number.isFinite(timestamp)) continue;
    const id = createHash('sha256').update(url).digest('hex').slice(0, 16);
    const excerpt = text(item['content:encoded'] || item.description).slice(0, 360);
    const { image, imageCredit } = imageFor(item, source);
    const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110) || id;
    articles.set(id, {
      id, slug, title, excerpt, url, image,
      imageCredit,
      source: source.name, sourceId, category: categoryFor(`${title} ${excerpt}`),
      publishedAt: new Date(timestamp).toISOString(),
    });
  }
  return [...articles.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
