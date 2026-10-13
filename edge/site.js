// Dipakai Cloudflare Pages Functions (tanpa dependensi). Harus selaras dengan src/news.ts,
// src/reports.ts, dan legacyListingTarget di src/app.ts — tests/static.test.ts memeriksanya.
export const CATEGORY_IDS = ['timnas', 'liga-indonesia', 'internasional', 'transfer'];
export const REPORT_KINDS = ['fakta', 'tafsir', 'bahasa', 'lainnya'];

export const listingPath = (category = 'semua', page = 1) =>
  `/artikel${category !== 'semua' ? `/kategori/${category}` : ''}${page > 1 ? `/halaman/${page}` : ''}`;

/** @param {URLSearchParams} params */
export function legacyListingTarget(params) {
  const q = (params.get('q') ?? '').trim().slice(0, 100);
  if (q) return `/cari?${new URLSearchParams({q})}`;
  if (!params.has('kategori') && !params.has('halaman')) return undefined;
  const category = CATEGORY_IDS.includes(params.get('kategori') ?? '') ? params.get('kategori') : 'semua';
  const page = /^[1-9]\d{0,8}$/.test(params.get('halaman') ?? '') ? Number(params.get('halaman')) : 1;
  return listingPath(category, page);
}
