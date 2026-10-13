import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CATEGORIES } from './news.js';
import type { Snapshot } from './store.js';
import type { Digest } from './digest.js';
import { REPORT_KINDS, type ReportLog } from './reports.js';
import { SOURCES, IMAGE_HOSTS, REFRESH_INTERVAL_MS } from './sources.js';

const root = path.resolve(import.meta.dirname, '..');
const SITE_URL = (process.env.SITE_URL || 'https://lekakick.com').replace(/\/$/, '');
const absolute = (value: string) => /^https?:\/\//.test(value) ? value : `${SITE_URL}${value}`;
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
const xml = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const breadcrumb = (trail: [string, string][]) => ({'@type':'BreadcrumbList', itemListElement:trail.map(([name, loc], index) =>
  ({'@type':'ListItem', position:index + 1, name, item:absolute(loc)}))});
// Judul panjang dipotong di hasil pencarian (~60 karakter); akhiran merek hanya ditambahkan bila muat.
const pageTitle = (title: string) => title.length <= 50 ? `${title} — lekakick` : title;
const ORGANIZATION = {'@type':'Organization', name:'lekakick', url:`${SITE_URL}/`, logo:{'@type':'ImageObject', url:`${SITE_URL}/assets/icon-512.png`, width:512, height:512}};
const categoryName = (id: string) => CATEGORIES.find(c => c.id === id)?.name ?? 'Sepak Bola';
const digestPath = (item: Digest) => `/artikel/${item.id}/${item.slug}`;
// Semua halaman memakai path tanpa query agar dapat diekspor menjadi berkas statis.
export const listingPath = (category = 'semua', page = 1) =>
  `/artikel${category !== 'semua' ? `/kategori/${category}` : ''}${page > 1 ? `/halaman/${page}` : ''}`;
export const PAGE_SIZE = 12;
const date = (value: string, full = false) => new Intl.DateTimeFormat('id-ID', {
  timeZone:'Asia/Jakarta', day:'numeric', month: full ? 'long' : 'short', year:'numeric',
  ...(full ? {hour:'2-digit',minute:'2-digit'} as const : {}),
}).format(new Date(value)) + (full ? ' WIB' : '');

/** Tujuan 301 untuk alamat lama `/artikel?kategori=…&halaman=…&q=…`; undefined bila tidak ada query yang dikenal. */
export function legacyListingTarget(query: Record<string, unknown>): string | undefined {
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  if (q) return `/cari?${new URLSearchParams({q})}`;
  const category = typeof query.kategori === 'string' && CATEGORIES.some(c => c.id === query.kategori) ? query.kategori : 'semua';
  const page = typeof query.halaman === 'string' && /^[1-9]\d{0,8}$/.test(query.halaman) ? Number(query.halaman) : 1;
  if (query.kategori === undefined && query.halaman === undefined) return undefined;
  return listingPath(category, page);
}

export function createApp(store: {snapshot(): Snapshot}, digests: {list(): Digest[]} = {list: () => []}, reports?: Pick<ReportLog, 'add'>) {
  const app = express();
  const digestRevision = () => createHash('sha256').update(digests.list().map(item => item.id).join(',')).digest('hex').slice(0, 32);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'", ...IMAGE_HOSTS.map(host => `https://${host}`), 'data:'], fontSrc: ["'self'"],
      connectSrc: ["'self'"], objectSrc:["'none'"], frameAncestors:["'none'"],
      formAction:["'self'"], baseUri:["'self'"], upgradeInsecureRequests: null,
    }}, strictTransportSecurity: false, crossOriginEmbedderPolicy: false,
    referrerPolicy: {policy:'strict-origin-when-cross-origin'},
  }));
  // Google dan browser lama mencari ikon di akar domain.
  for (const file of ['favicon.ico', 'apple-touch-icon.png']) {
    app.get(`/${file}`, (_req,res) => res.sendFile(path.join(root, 'public', file), {maxAge:'7d'}));
  }
  // Font dan aset ber-?v= tidak pernah berubah di URL yang sama, jadi boleh di-cache setahun.
  app.use('/assets', express.static(path.join(root, 'public'), {maxAge:'1d', dotfiles:'deny', index:false, setHeaders: (res, file) => {
    const req = (res as express.Response).req;
    if (req.query.v || file.includes(`${path.sep}fonts${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }}));
  app.get(['/healthz', '/api/status.json'], (_req,res) => {
    const state = store.snapshot();
    res.set('Cache-Control','no-store').json({
      status:state.items.length ? 'ok':'waiting', articles:state.items.length,
      updatedAt:state.updatedAt, lastAttemptAt:state.lastAttemptAt, degraded:state.degraded,
      revision:digestRevision(), feedRevision:state.revision ?? '', refreshIntervalMs:state.refreshIntervalMs ?? REFRESH_INTERVAL_MS,
      sources:state.sources ?? [],
    });
  });
  app.use((req,res,next) => {
    const state = store.snapshot();
    res.locals = {
      newsRevision:digestRevision(),
      siteUrl:SITE_URL, canonical:absolute(req.path), robots:'index,follow,max-image-preview:large', jsonLd:'', absolute,
      ...res.locals, state, categories:CATEGORIES, categoryName, digestPath, date,
      sources:SOURCES, sourceStates:state.sources ?? [], sourceId:'',
      refreshMinutes:(state.refreshIntervalMs ?? REFRESH_INTERVAL_MS) / 60_000,
      title:'lekakick — Kabar bola, dari semua sisi.',
      description:'Kurasi berita sepak bola Indonesia dan dunia. Ikuti kabar Timnas, Liga Indonesia, hingga bursa transfer dengan sumber yang jelas.',
      section:'beranda', category:'semua', article:null, listingPath,
      today: new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date()),
      year:new Date().getFullYear(),
    };
    res.set('Cache-Control','public, max-age=30');
    next();
  });
  const listing = (category: string, pageParam?: string) => {
    const filtered = digests.list().filter(item => category === 'semua' || item.category === category);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const page = pageParam === undefined ? 1 : /^[1-9]\d{0,8}$/.test(pageParam) ? Number(pageParam) : NaN;
    return {items:filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE), total:filtered.length, page, pages, category};
  };
  app.get('/', (_req,res) => {
    const all = digests.list();
    const lead = all.find(item => item.image) ?? all[0];
    const rest = all.filter(item => item.id !== lead?.id);
    res.render('home', {lead, side:rest.slice(0,2), latest:rest.slice(2,8), spotlight:all.slice(0,5),
      jsonLd:jsonLd({'@context':'https://schema.org', '@type':'WebSite', name:'lekakick', url:`${SITE_URL}/`, inLanguage:'id-ID', publisher:ORGANIZATION,
        potentialAction:{'@type':'SearchAction', target:`${SITE_URL}/cari?q={search_term_string}`, 'query-input':'required name=search_term_string'}})});
  });
  // Alamat lama berbasis query dialihkan ke path statis (di Cloudflare ditangani functions/artikel/index.js).
  app.get('/artikel', (req,res,next) => {
    const target = legacyListingTarget(req.query);
    if (target) return res.redirect(301, target);
    renderListing(res, next, 'semua');
  });
  app.get('/artikel/halaman/:page', (req,res,next) => renderListing(res, next, 'semua', req.params.page));
  app.get('/artikel/kategori/:category', (req,res,next) => renderListing(res, next, req.params.category));
  app.get('/artikel/kategori/:category/halaman/:page', (req,res,next) => renderListing(res, next, req.params.category, req.params.page));
  function renderListing(res: express.Response, next: express.NextFunction, category: string, pageParam?: string) {
    if (!CATEGORIES.some(c => c.id === category && c.id !== 'semua') && category !== 'semua') return next();
    const result = listing(category, pageParam);
    if (pageParam === '1') return res.redirect(301, listingPath(category));
    if (!Number.isInteger(result.page) || result.page > result.pages) return next();
    const listingName = category === 'semua' ? 'Semua Artikel' : categoryName(category);
    res.render('digests', {...result, section:'artikel',
      jsonLd:jsonLd({'@context':'https://schema.org', ...breadcrumb([['Beranda','/'],['Artikel','/artikel'],
        ...(category !== 'semua' ? [[listingName, listingPath(category)] as [string, string]] : [])])}),
      canonical:absolute(listingPath(category, result.page)),
      robots:!result.items.length ? 'noindex,follow' : 'index,follow,max-image-preview:large',
      title:`${listingName}${result.page > 1 ? ` (halaman ${result.page})` : ''} — lekakick`,
      description:'Rangkuman berita sepak bola Indonesia dan dunia dari berbagai media, disusun lekakick dengan sumber yang selalu dicantumkan.',
      pageLink:(page:number) => listingPath(category, page),
    });
  }
  app.get('/cari', (_req,res) => res.render('search', {robots:'noindex,follow', section:'cari', title:'Cari artikel — lekakick', canonical:absolute('/cari')}));
  // Halaman ringkasan RSS lama sudah dihapus: daftar dialihkan, detail dijawab 410 agar mesin pencari cepat membuangnya.
  app.get('/berita', (req,res) => res.redirect(301, legacyListingTarget(req.query) ?? '/artikel'));
  app.get('/berita/:id/:slug', (_req,res) => res.status(410).render('not-found', {robots:'noindex,follow', gone:true}));
  app.get('/artikel/:id/:slug', (req,res) => {
    const digest = digests.list().find(item => item.id === req.params.id);
    if (!digest) return res.status(404).render('not-found', {robots:'noindex,follow'});
    if (req.params.slug !== digest.slug) return res.redirect(301, digestPath(digest));
    res.render('digest', {digest, reportKinds:REPORT_KINDS, section:'artikel', category:digest.category, title:pageTitle(digest.title), description:digest.dek,
      ogImage:digest.image, publishedTime:digest.publishedAt,
      jsonLd:jsonLd({'@context':'https://schema.org', '@graph':[breadcrumb([['Beranda','/'],['Artikel','/artikel'],
        [categoryName(digest.category), listingPath(digest.category)],[digest.title, digestPath(digest)]]), {'@type':'NewsArticle', headline:digest.title.slice(0,110), description:digest.dek,
        datePublished:digest.publishedAt, dateModified:digest.publishedAt, inLanguage:'id-ID', mainEntityOfPage:absolute(digestPath(digest)),
        ...(digest.image ? {image:[digest.image]} : {}), articleSection:categoryName(digest.category),
        author:{'@type':'Organization', name:'Redaksi lekakick', url:`${SITE_URL}/tentang`}, publisher:ORGANIZATION,
        citation:digest.sources.map(source => ({'@type':'NewsArticle', headline:source.title, url:source.url, publisher:{'@type':'Organization', name:source.source}}))}]}),
      related:digests.list().filter(item => item.id !== digest.id && item.category === digest.category).slice(0,3)});
  });
  // Di Cloudflare rute ini ditangani functions/api/lapor.js dengan logika yang sama.
  app.post('/api/lapor', express.urlencoded({extended:false, limit:'4kb', parameterLimit:6}), async (req,res) => {
    const body = req.body as Record<string, unknown>;
    const digest = digests.list().find(item => item.id === body.artikel);
    if (!digest) return res.status(404).render('not-found', {robots:'noindex,follow'});
    const back = (status: string) => res.redirect(303, `${digestPath(digest)}?lapor=${status}#lapor`);
    // Kolom "website" tersembunyi: hanya bot yang mengisinya.
    if (body.website) return back('terkirim');
    const kind = typeof body.jenis === 'string' && body.jenis in REPORT_KINDS ? body.jenis as keyof typeof REPORT_KINDS : undefined;
    const note = typeof body.catatan === 'string' ? body.catatan.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    if (!kind || !reports) return back('gagal');
    const sender = req.get('x-real-ip') || req.socket.remoteAddress || 'unknown';
    try { return back(await reports.add({digestId:digest.id, kind, note}, sender) ? 'terkirim' : 'batas'); }
    catch { return back('gagal'); }
  });
  app.get('/simpan', (_req,res) => res.render('saved', {robots:'noindex,follow', section:'simpan', title:'Bacaan saya — lekakick'}));
  // Indeks ringan untuk pencarian dan "Bacaan saya" yang berjalan di browser.
  app.get('/api/artikel.json', (_req,res) => {
    res.json({items:digests.list().map(item => ({id:item.id, title:item.title, excerpt:item.dek, image:item.image,
      path:digestPath(item), category:item.category, categoryLabel:categoryName(item.category), dateLabel:date(item.publishedAt)}))});
  });
  app.get('/tentang', (_req,res) => res.render('info', {section:'tentang', title:'Tentang lekakick', kind:'about'}));
  app.get('/privasi', (_req,res) => res.render('info', {section:'privasi', title:'Privasi — lekakick', kind:'privacy'}));
  app.get('/robots.txt', (_req,res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /simpan\n\nSitemap: ${SITE_URL}/sitemap.xml\n`));
  app.get('/sitemap.xml', (_req,res) => {
    const all = digests.list();
    const newest = all[0]?.publishedAt;
    const pages: {loc:string; lastmod?:string|null}[] = [
      {loc:'/', lastmod:newest}, ...(all.length ? [{loc:'/artikel', lastmod:newest}] : []),
      ...CATEGORIES.filter(c => c.id !== 'semua').flatMap(c => {
        const latest = all.find(item => item.category === c.id);
        return latest ? [{loc:listingPath(c.id), lastmod:latest.publishedAt}] : [];
      }),
      {loc:'/tentang'}, {loc:'/privasi'},
      ...all.map(item => ({loc:digestPath(item), lastmod:item.publishedAt})),
    ];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      pages.map(page => `<url><loc>${xml(absolute(page.loc))}</loc>${page.lastmod && !Number.isNaN(Date.parse(page.lastmod)) ? `<lastmod>${new Date(page.lastmod).toISOString()}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
  });
  app.use((_req,res) => res.status(404).render('not-found', {robots:'noindex,follow'}));
  app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction) => {
    console.error('Request gagal:',error.message);
    res.status(500).type('text/plain').send('Halaman belum dapat ditampilkan. Silakan coba lagi.');
  });
  return app;
}
