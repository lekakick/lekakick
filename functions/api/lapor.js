import { REPORT_KINDS } from '../../edge/site.js';

const HOUR = 3600;
const LIMIT_PER_HOUR = 5;

// Laporan kesalahan pembaca disimpan di KV "LAPORAN" (lihat Cloudflare → Workers & Pages → KV).
export const onRequestPost = async ({request, env}) => {
  const url = new URL(request.url);
  if (Number(request.headers.get('Content-Length') ?? 0) > 4096) return new Response('Terlalu besar', {status: 413});
  let form;
  try { form = await request.formData(); } catch { return new Response('Formulir tidak valid', {status: 400}); }
  const id = String(form.get('artikel') ?? '');
  const index = /^[a-f0-9]{16}$/.test(id) ? await env.ASSETS.fetch(new URL('/api/artikel.json', url)).then(r => r.json()).catch(() => ({items: []})) : {items: []};
  const digest = index.items.find(item => item.id === id);
  if (!digest) return new Response('Artikel tidak ditemukan', {status: 404});
  const back = status => new Response(null, {status: 303, headers: {Location: `${digest.path}?lapor=${status}#lapor`}});
  // Kolom "website" tersembunyi: hanya bot yang mengisinya.
  if (form.get('website')) return back('terkirim');
  const kind = String(form.get('jenis') ?? '');
  if (!REPORT_KINDS.includes(kind) || !env.LAPORAN) return back('gagal');
  const note = String(form.get('catatan') ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const sender = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const slot = `batas:${sender}:${Math.floor(Date.now() / 1000 / HOUR)}`;
  try {
    const sent = Number(await env.LAPORAN.get(slot) ?? 0);
    if (sent >= LIMIT_PER_HOUR) return back('batas');
    await env.LAPORAN.put(slot, String(sent + 1), {expirationTtl: 2 * HOUR});
    const at = new Date().toISOString();
    await env.LAPORAN.put(`laporan:${at}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify({digestId: id, kind, note, at}));
    return back('terkirim');
  } catch { return back('gagal'); }
};
