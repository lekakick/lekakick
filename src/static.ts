import type express from 'express';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CATEGORIES } from './news.js';
import type { Digest } from './digest.js';
import { listingPath, PAGE_SIZE } from './app.js';

const root = path.resolve(import.meta.dirname, '..');
// Header keamanan dari helmet yang ikut disalin ke _headers Cloudflare Pages.
const SECURITY_HEADERS = ['content-security-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'origin-agent-cluster',
  'referrer-policy', 'x-content-type-options', 'x-dns-prefetch-control', 'x-download-options', 'x-frame-options', 'x-permitted-cross-domain-policies', 'x-xss-protection'];
// Rute yang tetap butuh kode di server (Pages Functions); selain ini semuanya berkas statis.
export const FUNCTION_ROUTES = ['/artikel', '/berita', '/berita/*', '/api/lapor'];

/** Daftar semua path publik yang perlu ditulis menjadi berkas. */
export function sitePaths(digests: Digest[]): string[] {
  const listing = (category: string) => {
    const count = digests.filter(item => category === 'semua' || item.category === category).length;
    if (category !== 'semua' && !count) return [];
    return Array.from({length: Math.max(1, Math.ceil(count / PAGE_SIZE))}, (_, i) => listingPath(category, i + 1));
  };
  return ['/', ...CATEGORIES.flatMap(c => listing(c.id)), ...digests.map(item => `/artikel/${item.id}/${item.slug}`),
    '/cari', '/simpan', '/tentang', '/privasi', '/robots.txt', '/sitemap.xml', '/api/artikel.json', '/api/status.json'];
}

/** `/artikel/x` → `artikel/x.html` agar Cloudflare Pages melayaninya di URL yang sama tanpa garis miring akhir. */
export const fileFor = (urlPath: string) => urlPath === '/' ? 'index.html' : /\.[a-z]+$/.test(urlPath) ? urlPath.slice(1) : `${urlPath.slice(1)}.html`;

export async function exportSite(app: express.Express, digests: Digest[], outDir: string): Promise<{pages: number}> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await rm(outDir, {recursive: true, force: true});
    await mkdir(outDir, {recursive: true});
    const write = async (file: string, body: string | Buffer) => {
      const target = path.join(outDir, file);
      await mkdir(path.dirname(target), {recursive: true});
      await writeFile(target, body);
    };
    const paths = sitePaths(digests);
    let headers: Headers | undefined;
    for (const urlPath of paths) {
      const response = await fetch(base + urlPath, {redirect: 'manual'});
      if (response.status !== 200) throw new Error(`Ekspor ${urlPath} gagal: HTTP ${response.status}`);
      headers ??= response.headers;
      await write(fileFor(urlPath), Buffer.from(await response.arrayBuffer()));
    }
    // 404.html dipakai otomatis oleh Pages; 410.html dipakai functions/berita untuk halaman RSS lama.
    for (const [urlPath, file, status] of [['/halaman-tidak-ada', '404.html', 404], ['/berita/0/lama', '410.html', 410]] as const) {
      const response = await fetch(base + urlPath);
      if (response.status !== status) throw new Error(`Ekspor ${file} gagal: HTTP ${response.status}`);
      await write(file, await response.text());
    }
    await cp(path.join(root, 'public'), path.join(outDir, 'assets'), {recursive: true});
    for (const file of ['favicon.ico', 'apple-touch-icon.png']) await cp(path.join(root, 'public', file), path.join(outDir, file));
    // Font, CSS, dan JS dipanggil dengan ?v= atau tidak pernah berubah, jadi aman di-cache setahun.
    const assets = await readdir(path.join(root, 'public'), {recursive: true, withFileTypes: true});
    const assetRules = assets.filter(entry => entry.isFile()).map(entry => {
      const rel = path.relative(path.join(root, 'public'), path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
      const long = rel.startsWith('fonts/') || /^(styles\.css|app\.js|placeholder\.svg)$/.test(rel);
      return `/assets/${rel}\n  Cache-Control: ${long ? 'public, max-age=31536000, immutable' : 'public, max-age=86400'}`;
    });
    const security = SECURITY_HEADERS.flatMap(name => headers?.get(name) ? [`  ${name}: ${headers.get(name)}`] : []);
    await write('_headers', [`/*\n${security.join('\n')}`, '/api/*\n  Cache-Control: no-cache\n  X-Robots-Tag: noindex', ...assetRules].join('\n') + '\n');
    await write('_routes.json', JSON.stringify({version: 1, include: FUNCTION_ROUTES, exclude: []}, null, 2) + '\n');
    return {pages: paths.length};
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
