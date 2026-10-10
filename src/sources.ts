export type SourceId = 'antara' | 'detik' | 'bola' | 'tempo';
export interface Source {
  id: SourceId; name: string; homepage: string;
  articleHosts: readonly string[]; imageHosts: readonly string[]; pathPrefixes: readonly string[];
}
export const SOURCES: readonly Source[] = [
  { id: 'antara', name: 'ANTARA News', homepage: 'https://www.antaranews.com/sepakbola', articleHosts: ['www.antaranews.com', 'antaranews.com'], imageHosts: ['cdn.antaranews.com'], pathPrefixes: ['/berita/'] },
  { id: 'detik', name: 'detikSport', homepage: 'https://sport.detik.com/sepakbola', articleHosts: ['sport.detik.com'], imageHosts: ['akcdn.detik.net.id'], pathPrefixes: ['/sepakbola/'] },
  { id: 'bola', name: 'Bola.com', homepage: 'https://www.bola.com', articleHosts: ['www.bola.com', 'bola.com'], imageHosts: ['cdn0-production-images-kly.akamaized.net', 'cdn1-production-images-kly.akamaized.net'], pathPrefixes: ['/indonesia/', '/inggris/', '/dunia/', '/spanyol/'] },
  { id: 'tempo', name: 'Tempo', homepage: 'https://www.tempo.co/sepakbola', articleHosts: ['www.tempo.co', 'tempo.co'], imageHosts: ['images-tm.tempo.co', 'statik.tempo.co'], pathPrefixes: ['/sepakbola/'] },
];
export interface Feed { url: string; sourceId: SourceId }
export const FEEDS: readonly Feed[] = [
  { url: 'https://www.antaranews.com/rss/sepakbola.xml', sourceId: 'antara' },
  { url: 'https://www.antaranews.com/rss/sepakbola-liga-indonesia.xml', sourceId: 'antara' },
  { url: 'https://www.antaranews.com/rss/sepakbola-internasional.xml', sourceId: 'antara' },
  { url: 'https://www.antaranews.com/rss/sepakbola-liga-inggris-premier.xml', sourceId: 'antara' },
  { url: 'https://sport.detik.com/sepakbola/rss', sourceId: 'detik' },
  { url: 'https://sport.detik.com/sepakbola/liga-indonesia/rss', sourceId: 'detik' },
  { url: 'https://feed.bola.com/rss/indonesia', sourceId: 'bola' },
  { url: 'https://feed.bola.com/rss/inggris', sourceId: 'bola' },
  { url: 'https://feed.bola.com/rss/dunia', sourceId: 'bola' },
  { url: 'https://feed.bola.com/rss/spanyol', sourceId: 'bola' },
  { url: 'https://pustaka-api.tempo.co/single-brand/rss/free/sepakbola', sourceId: 'tempo' },
];
export const REFRESH_INTERVAL_MS = 300_000;
export const IMAGE_HOSTS = [...new Set(SOURCES.flatMap(source => source.imageHosts))];
