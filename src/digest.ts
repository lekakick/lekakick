import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CATEGORIES, type Article, type Category } from './news.js';

// Ringkasan multi-sumber: hanya peristiwa yang diberitakan >=2 penerbit berbeda,
// ditulis ulang dari fakta judul + cuplikan RSS, lalu diverifikasi sebelum terbit.
export interface DigestSource { articleId: string; title: string; source: string; url: string }
export interface Digest {
  id: string; slug: string; title: string; dek: string; paragraphs: string[]; analysis?: string[]; category: Category;
  image: string; imageCredit: string; sources: DigestSource[]; publishedAt: string; model: string;
}
export interface DigestOptions {
  dataDir: string; apiKey?: string; model?: string; baseUrl?: string; dailyLimit?: number; perRun?: number; minGapMinutes?: number;
  fetch?: typeof fetch; now?: () => Date;
}

const STOPWORDS = new Set(('yang dan di ke dari untuk dengan pada ini itu dalam akan tidak juga atau sebagai oleh karena saat bisa sudah lebih masih para jadi usai bagi tak tapi agar dia ada '
  + 'vs kontra lawan laga tim pemain pelatih jelang hari kata bola sepak liga klub main menang kalah imbang skor gol '
  + 'hasil super league bri fifa asean cup piala aff timnas indonesia juara legenda legends premier inggris italia spanyol eropa dunia usai buka suara akhirnya').split(' '));
export function keywords(text: string): Set<string> {
  return new Set(text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !STOPWORDS.has(word)));
}
function similarity(a: Set<string>, b: Set<string>): { shared: number; score: number } {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return { shared, score: shared / Math.max(1, Math.min(a.size, b.size)) };
}

// Jadwal, tautan siaran, dan prediksi tidak punya fakta peristiwa untuk dirangkum.
const LOW_VALUE = /live streaming|link streaming|siaran langsung|jadwal|prediksi|link nonton/i;
/** Kelompokkan berita dari penerbit berbeda yang membahas peristiwa yang sama. */
export function findClusters(items: Article[], options: { now: Date; used: Set<string>; maxAgeHours?: number }): Article[][] {
  const cutoff = options.now.getTime() - (options.maxAgeHours ?? 36) * 3_600_000;
  const fresh = items.filter(item => !options.used.has(item.id) && Date.parse(item.publishedAt) >= cutoff && item.excerpt.length >= 60 && !LOW_VALUE.test(item.title));
  const words = new Map(fresh.map(item => [item.id, keywords(item.title)]));
  const fullWords = new Map(fresh.map(item => [item.id, keywords(`${item.title} ${item.excerpt}`)]));
  const taken = new Set<string>();
  const clusters: Article[][] = [];
  for (const seed of fresh) {
    if (taken.has(seed.id)) continue;
    const seedWords = words.get(seed.id)!;
    const members = [seed];
    for (const other of fresh) {
      if (other.id === seed.id || taken.has(other.id) || members.some(member => member.sourceId === other.sourceId)) continue;
      if (Math.abs(Date.parse(other.publishedAt) - Date.parse(seed.publishedAt)) > 24 * 3_600_000) continue;
      const title = similarity(seedWords, words.get(other.id)!);
      const body = similarity(fullWords.get(seed.id)!, fullWords.get(other.id)!);
      if (title.shared >= 3 && title.score >= 0.5 && body.score >= 0.35) members.push(other);
    }
    // Bahan terlalu tipis menghasilkan tulisan berulang; lewati.
    if (members.length < 2 || members.reduce((sum, item) => sum + item.excerpt.length, 0) < 260) continue;
    members.forEach(member => taken.add(member.id));
    clusters.push(members.slice(0, 4));
  }
  return clusters.sort((a, b) => b.length - a.length || b[0]!.publishedAt.localeCompare(a[0]!.publishedAt));
}

const shingles = (text: string, size: number) => {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
};
/** Tolak hasil yang menyalin rangkaian 8 kata atau lebih dari sumber. */
export function copiedPhrase(output: string, sources: Article[]): string | undefined {
  const source = new Set(sources.flatMap(item => [...shingles(`${item.title}. ${item.excerpt}`, 8)]));
  for (const phrase of shingles(output, 8)) if (source.has(phrase)) return phrase;
}

const numbers = (text: string) => text.match(/\d+(?:[.,]\d+)*/g) ?? [];
/** Angka di tulisan wajib ada di bahan: penjaga utama terhadap skor, statistik, atau tanggal karangan. */
export function inventedNumber(output: string, sources: Article[]): string | undefined {
  const allowed = new Set(sources.flatMap(item => {
    const date = new Date(item.publishedAt);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date).split('-').map(Number);
    return [...numbers(`${item.title} ${item.excerpt}`), ...local.map(String)];
  }).flatMap(value => [value, value.replace(/^0+(?=\d)/, '')]));
  return numbers(output).find(value => !allowed.has(value) && !allowed.has(value.replace(/^0+(?=\d)/, '')));
}

export function validateDraft(value: unknown, sources: Article[]): { title: string; dek: string; paragraphs: string[]; analysis: string[] } {
  if (!value || typeof value !== 'object') throw new Error('Respons AI bukan objek');
  const draft = value as Record<string, unknown>;
  const clean = (text: unknown) => typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  const title = clean(draft.title), dek = clean(draft.dek);
  const paragraphs = Array.isArray(draft.paragraphs) ? draft.paragraphs.map(clean).filter(Boolean) : [];
  const analysis = Array.isArray(draft.analysis) ? draft.analysis.map(clean).filter(Boolean) : [];
  if (title.length < 20 || title.length > 70) throw new Error(`Judul tidak valid (${title.length} karakter)`);
  if (dek.length < 40 || dek.length > 260) throw new Error('Dek tidak valid');
  if (paragraphs.length < 2 || paragraphs.length > 8 || paragraphs.some(p => p.length > 900)) throw new Error('Paragraf tidak valid');
  const all = [title, dek, ...paragraphs].join(' ');
  const wordCount = all.split(/\s+/).length;
  if (wordCount < 70 || wordCount > 700) throw new Error(`Panjang tidak valid (${wordCount} kata)`);
  if (analysis.length < 2 || analysis.length > 4 || analysis.some(p => p.length > 900)) throw new Error('Analisis tidak valid');
  const analysisWords = analysis.join(' ').split(/\s+/).length;
  if (analysisWords < 60 || analysisWords > 320) throw new Error(`Panjang analisis tidak valid (${analysisWords} kata)`);
  const everything = [all, ...analysis].join(' ');
  if (/https?:\/\/|www\.|[*#`]|\[|\]/.test(everything)) throw new Error('Memuat tautan atau markdown');
  const copied = copiedPhrase(everything, sources);
  if (copied) throw new Error(`Terlalu mirip sumber: "${copied}"`);
  const invented = inventedNumber(everything, sources);
  if (invented) throw new Error(`Angka tidak ada di bahan: "${invented}"`);
  return { title, dek, paragraphs, analysis };
}

const SYSTEM_PROMPT = `Kamu adalah redaktur berita sepak bola berbahasa Indonesia untuk situs lekakick.
Tugasmu: menulis SATU artikel rangkuman orisinal tentang satu peristiwa, berdasarkan fakta dari beberapa laporan media.
Aturan wajib:
- Gunakan HANYA fakta yang ada di bahan. Jangan menambah skor, angka, tanggal, nama, atau kutipan yang tidak ada di bahan.
- Tulis dengan kata-kata dan struktur sendiri. Jangan pernah menyalin lebih dari 5 kata berurutan dari bahan, termasuk dari judulnya; ubah susunan kalimat walau faktanya sama.
- Fokus pada peristiwa dan tokohnya, bukan pada medianya. Sebut nama media hanya sebagai atribusi untuk klaim atau kutipan penting (contoh: "menurut detikSport"), cukup sekali atau dua kali.
- JANGAN membahas perbedaan sudut pandang, gaya, atau penamaan antar-media, dan jangan menutup artikel dengan paragraf tentang laporan atau media. Sebut perbedaan hanya jika faktanya bertentangan (skor, angka, tanggal).
- Cuplikan yang berakhir dengan "..." terpotong: jangan kutip atau tebak bagian yang terpotong.
- Jangan memindahkan detail waktu atau tempat dari satu laporan ke peristiwa lain yang tidak disebut laporan itu.
- Kutipan langsung hanya boleh jika ada di bahan, maksimal satu kalimat pendek, dan sebutkan siapa yang mengatakan.
- Bagian "paragraphs" hanya berisi FAKTA dari bahan, tanpa opini.
- Gaya: lugas, enak dibaca, bahasa Indonesia baku tidak kaku. Tanpa clickbait, tanpa opini berlebihan, tanpa markdown, tanpa tautan.
- Panjang 130-400 kata. Uraikan setiap fakta di bahan dengan jelas (siapa, apa, kapan, di mana, mengapa jika ada), tetapi jangan mengarang. Setiap fakta cukup disebut SATU kali; jangan mengulang fakta yang sama di paragraf lain dan jangan menambah kalimat pengisi.
Bagian "analysis" (2-3 paragraf, 80-220 kata) adalah analisis redaksi lekakick:
- Tafsirkan fakta di atas: mengapa peristiwa ini penting, apa dampaknya bagi tim, pemain, atau kompetisi, dan apa yang patut diperhatikan selanjutnya.
- Boleh beropini dengan nada wajar, seimbang, dan berargumen. Gunakan kata seperti "bisa", "berpotensi", "patut ditunggu" untuk hal yang belum pasti.
- DILARANG menyebut angka, skor, statistik, tanggal, rekor, posisi klasemen, nilai transfer, atau peristiwa lain yang TIDAK ada di bahan. Jangan menulis angka apa pun yang tidak ada di bahan.
- Jangan menyiratkan posisi klasemen, persaingan papan atas/juara/degradasi, rentetan hasil, atau kondisi tim yang tidak disebut di bahan (misalnya jangan menulis "memperkuat posisi di papan atas" bila bahan tidak menyebut klasemen).
- Latar belakang umum hanya boleh jika sangat umum dan pasti benar (misalnya "MU dan Arsenal adalah rival lama di Inggris"); hindari klaim spesifik tentang sejarah, gelar, atau prestasi.
- Jangan mengulang isi "paragraphs"; tambahkan sudut pandang.
Balas HANYA JSON: {"title": "judul 35-65 karakter, padat, tanpa titik di akhir", "dek": "ringkasan satu kalimat", "paragraphs": ["paragraf fakta 1", "..."], "analysis": ["paragraf analisis 1", "..."]} dengan 3-6 paragraf fakta (minimal 2 jika bahan sangat sedikit).`;

export function promptFor(cluster: Article[]): string {
  return `Bahan dari ${cluster.length} media:\n\n` + cluster.map((item, index) =>
    `[${index + 1}] ${item.source} (${item.publishedAt})\nJudul: ${item.title}\nCuplikan: ${item.excerpt}`).join('\n\n');
}

const majorityCategory = (cluster: Article[]): Category => {
  const counts = new Map<Category, number>();
  for (const item of cluster) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
};
export const slugify = (title: string, id: string) => title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110) || id;
const CATEGORY_IDS = new Set<string>(CATEGORIES.map(c => c.id));

function restore(value: unknown): Digest | undefined {
  if (!value || typeof value !== 'object') return;
  const d = value as Digest;
  const strings = [d.id, d.slug, d.title, d.dek, d.image, d.imageCredit, d.publishedAt, d.model];
  if (strings.some(s => typeof s !== 'string') || !/^[a-f0-9]{16}$/.test(d.id) || !CATEGORY_IDS.has(d.category)) return;
  if (!Array.isArray(d.paragraphs) || !d.paragraphs.every(p => typeof p === 'string')) return;
  if (d.analysis !== undefined && (!Array.isArray(d.analysis) || !d.analysis.every(p => typeof p === 'string'))) return;
  if (!Array.isArray(d.sources) || !d.sources.every(s => s && typeof s.url === 'string' && s.url.startsWith('https://') && typeof s.source === 'string' && typeof s.title === 'string')) return;
  if (d.image && !d.image.startsWith('https://')) return;
  return d;
}

export class DigestStore {
  private items: Digest[] = [];
  private usedArticles = new Set<string>();
  private running: Promise<void> | null = null;
  private readonly file: string;
  private readonly request: typeof fetch;
  private readonly now: () => Date;
  constructor(private readonly options: DigestOptions) {
    this.file = path.join(options.dataDir, 'digests.json');
    this.request = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }
  get enabled(): boolean { return Boolean(this.options.apiKey); }
  list(): Digest[] { return this.items; }
  find(id: string): Digest | undefined { return this.items.find(item => item.id === id); }
  async init(): Promise<void> {
    await mkdir(this.options.dataDir, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      this.items = (Array.isArray(saved.items) ? saved.items : []).map(restore).filter(Boolean).slice(0, 500) as Digest[];
      this.usedArticles = new Set(Array.isArray(saved.usedArticles) ? saved.usedArticles.filter((id: unknown) => typeof id === 'string').slice(-5000) : []);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Arsip ringkasan diabaikan');
    }
  }
  private publishedToday(): number {
    const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date);
    const today = day(this.now());
    return this.items.filter(item => day(new Date(item.publishedAt)) === today).length;
  }
  /** Buat ringkasan baru dari berita terkini; aman dipanggil berulang. */
  run(items: Article[]): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (!this.running) this.running = this.perform(items).finally(() => { this.running = null; });
    return this.running;
  }
  private async perform(items: Article[]): Promise<void> {
    const remaining = Math.min(this.options.perRun ?? 1, (this.options.dailyLimit ?? 12) - this.publishedToday());
    if (remaining <= 0) return;
    // Sebar penerbitan sepanjang hari, bukan sekaligus.
    const last = this.items[0] ? Date.parse(this.items[0].publishedAt) : 0;
    if (this.now().getTime() - last < (this.options.minGapMinutes ?? 60) * 60_000) return;
    // Peristiwa yang sudah dirangkum 48 jam terakhir tidak dibuat ulang saat media lain menyusul.
    const recent = this.items.filter(item => this.now().getTime() - Date.parse(item.publishedAt) < 48 * 3_600_000)
      .flatMap(item => item.sources.map(source => keywords(source.title)));
    const repeats = (cluster: Article[]) => cluster.some(item => recent.some(words => {
      const { shared, score } = similarity(keywords(item.title), words);
      return shared >= 3 && score >= 0.5;
    }));
    const clusters = findClusters(items, { now: this.now(), used: this.usedArticles })
      .filter(cluster => !repeats(cluster) || (cluster.forEach(item => this.usedArticles.add(item.id)), false));
    if (!clusters.length) console.info('Ringkasan: belum ada topik baru yang diberitakan minimal 2 media');
    let published = 0, attempts = 0;
    for (const cluster of clusters) {
      // Draf yang ditolak tidak dihitung; coba topik berikutnya dalam batas wajar.
      if (published >= remaining || attempts++ >= remaining + 2) break;
      // Tandai terpakai juga saat gagal, agar topik bermasalah tidak dicoba terus.
      cluster.forEach(item => this.usedArticles.add(item.id));
      try {
        let raw = await this.generate(cluster).catch(async error => {
          // Respons terpotong (penalaran model kepanjangan) dicoba sekali lagi.
          if (error instanceof Error && error.message.startsWith('Respons AI kosong')) return this.generate(cluster);
          throw error;
        });
        let draft;
        try { draft = validateDraft(raw, cluster); }
        catch (error) {
          // Satu kesempatan memperbaiki frasa yang terlalu mirip sumber.
          if (!(error instanceof Error) || !/^(Terlalu mirip|Angka tidak ada)/.test(error.message)) throw error;
          const fix = error.message.startsWith('Terlalu mirip')
            ? `Draf ini memuat frasa yang disalin dari bahan: ${error.message.slice(21)}. Tulis ulang seluruh JSON dengan susunan kalimat sendiri; jangan ada 6 kata berurutan yang sama dengan bahan.`
            : `Draf ini memuat angka yang tidak ada di bahan: ${error.message.slice(24)}. Tulis ulang seluruh JSON tanpa angka tersebut; jangan menulis angka apa pun yang tidak tercantum di bahan.`;
          raw = await this.generate(cluster, [JSON.stringify(raw), fix]);
          draft = validateDraft(raw, cluster);
        }
        const id = createHash('sha256').update(cluster.map(item => item.id).sort().join(',')).digest('hex').slice(0, 16);
        const withImage = cluster.find(item => item.image);
        this.items.unshift({
          id, slug: slugify(draft.title, id), ...draft, category: majorityCategory(cluster),
          image: withImage?.image ?? '', imageCredit: withImage ? `Foto: ${withImage.source}` : '',
          sources: cluster.map(item => ({ articleId: item.id, title: item.title, source: item.source, url: item.url })),
          publishedAt: this.now().toISOString(), model: this.options.model ?? 'deepseek-flash',
        });
        this.items = this.items.slice(0, 500);
        published++;
        console.info(`Ringkasan terbit ${id} dari ${cluster.map(item => item.sourceId).join('+')}: ${draft.title}`);
      } catch (error) {
        console.warn(`Ringkasan dilewati (${cluster.map(item => item.sourceId).join('+')}): ${error instanceof Error ? error.message : 'gagal'}`);
      }
      await this.save();
    }
  }
  private async generate(cluster: Article[], revision?: [string, string]): Promise<unknown> {
    const response = await this.request(`${this.options.baseUrl ?? 'https://api.deepseek.com'}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(90_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({
        model: this.options.model ?? 'deepseek-flash', temperature: 0.7, max_tokens: 16000, reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: promptFor(cluster) },
          ...(revision ? [{ role: 'assistant', content: revision[0] }, { role: 'user', content: revision[1] }] : [])],
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    const body = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Respons AI kosong (${body.choices?.[0]?.finish_reason ?? 'tanpa alasan'})`);
    try { return JSON.parse(content); } catch { throw new Error('Respons AI bukan JSON'); }
  }
  private async save(): Promise<void> {
    try {
      await writeFile(`${this.file}.tmp`, JSON.stringify({ version: 1, items: this.items, usedArticles: [...this.usedArticles].slice(-5000) }), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    } catch { console.error('Gagal menyimpan arsip ringkasan'); }
  }
}
