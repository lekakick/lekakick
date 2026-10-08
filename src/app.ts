import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { CATEGORIES, queryArticles, type Article } from './news.js';
import type { Snapshot } from './store.js';

const root = path.resolve(import.meta.dirname, '..');
const categoryName = (id: string) => CATEGORIES.find(c => c.id === id)?.name ?? 'Sepak Bola';
const articlePath = (item: Article) => `/berita/${item.id}/${item.slug}`;
const date = (value: string, full = false) => new Intl.DateTimeFormat('id-ID', {
  timeZone:'Asia/Jakarta', day:'numeric', month: full ? 'long' : 'short', year:'numeric',
  ...(full ? {hour:'2-digit',minute:'2-digit'} as const : {}),
}).format(new Date(value)) + (full ? ' WIB' : '');

export function createApp(store: {snapshot(): Snapshot}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'", 'https://cdn.antaranews.com', 'data:'], fontSrc: ["'self'"],
      connectSrc: ["'self'"], objectSrc:["'none'"], frameAncestors:["'none'"],
      formAction:["'self'"], baseUri:["'self'"], upgradeInsecureRequests: null,
    }}, strictTransportSecurity: false, crossOriginEmbedderPolicy: false,
    referrerPolicy: {policy:'strict-origin-when-cross-origin'},
  }));
  app.use('/assets', express.static(path.join(root, 'public'), {maxAge:'1d', dotfiles:'deny', index:false}));
  app.get('/healthz', (_req,res) => {
    const state = store.snapshot();
    res.set('Cache-Control','no-store').json({status: state.items.length ? 'ok':'waiting', articles: state.items.length, updatedAt:state.updatedAt, degraded:state.degraded});
  });
  app.use((req,res,next) => {
    const state = store.snapshot();
    res.locals = {
      ...res.locals, state, categories:CATEGORIES, categoryName, articlePath, date,
      title:'lekakick — Kabar bola, dari semua sisi.',
      description:'Kurasi berita sepak bola Indonesia dan dunia. Ikuti kabar Timnas, Liga Indonesia, hingga bursa transfer dengan sumber yang jelas.',
      section:'beranda', q:'', category:'semua', article:null,
      today: new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date()),
      year:new Date().getFullYear(),
    };
    res.set('Cache-Control','public, max-age=30');
    next();
  });
  app.get('/', (_req,res) => {
    const items = store.snapshot().items;
    const lead = items.find(item => item.category === 'timnas') ?? items[0];
    const side = items.filter(item => item.id !== lead?.id).slice(0, 2);
    const used = new Set([lead?.id, ...side.map(item => item.id)]);
    res.render('home', {lead, side, latest:items.filter(item => !used.has(item.id)).slice(0,6), spotlight:items.slice(0,5)});
  });
  app.get('/berita', (req,res) => {
    const result = queryArticles(store.snapshot().items, {q:req.query.q, category:req.query.kategori, page:req.query.halaman});
    res.render('listing', {...result, section:'berita', title:`${result.q ? `Hasil pencarian: ${result.q}` : categoryName(result.category)} — lekakick`,
      pageLink:(page:number) => `/berita?${new URLSearchParams({kategori:result.category,q:result.q,halaman:String(page)})}`,
    });
  });
  app.get('/berita/:id/:slug', (req,res) => {
    const article = store.snapshot().items.find(item => item.id === req.params.id);
    if (!article) return res.status(404).render('not-found');
    if (req.params.slug !== article.slug) return res.redirect(301,articlePath(article));
    res.render('article', {article, title:`${article.title} — lekakick`, description:article.excerpt, category:article.category, section:'berita',
      related:store.snapshot().items.filter(item => item.category === article.category && item.id !== article.id).slice(0,3),
    });
  });
  app.get('/simpan', (_req,res) => res.render('saved', {section:'simpan', title:'Bacaan saya — lekakick'}));
  app.get('/api/berita', (req,res) => {
    const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',').filter(id => /^[a-f0-9]{16}$/.test(id)).slice(0,100) : [];
    const items = store.snapshot().items.filter(item => ids.includes(item.id)).map(item => ({...item, path:articlePath(item), categoryLabel:categoryName(item.category), dateLabel:date(item.publishedAt)}));
    res.json({items});
  });
  app.get('/tentang', (_req,res) => res.render('info', {section:'tentang', title:'Tentang lekakick', kind:'about'}));
  app.get('/privasi', (_req,res) => res.render('info', {section:'privasi', title:'Privasi — lekakick', kind:'privacy'}));
  app.get('/robots.txt', (_req,res) => res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /simpan\n'));
  app.use((_req,res) => res.status(404).render('not-found'));
  app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction) => {
    console.error('Request gagal:',error.message);
    res.status(500).type('text/plain').send('Halaman belum dapat ditampilkan. Silakan coba lagi.');
  });
  return app;
}
