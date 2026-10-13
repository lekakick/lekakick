# lekakick

Portal kurasi berita sepak bola berbahasa Indonesia. Source workspace: `/root/web`.
Deployment: `/opt/garisbola`. Public URL: `http://5.189.131.6/`.

## Fitur
- Beranda editorial responsif, berita utama, kategori, pencarian, pagination.
- Halaman ringkasan RSS dengan atribusi ANTARA News, detikSport, Bola.com, atau Tempo, waktu terbit asli, kredit foto, dan tautan laporan lengkap.
- Bacaan saya memakai localStorage; bagikan via Web Share/clipboard dengan dialog salin sebagai fallback HTTP.
- SSR HTML, metadata Open Graph, font lokal, CSP, input escaping, URL allowlist, pembatasan RSS.
- Sebelas feed RSS dari empat penerbit diperiksa otomatis setiap 5 menit, tanpa perlu pengunjung. Cache disk atomik bertahan saat restart/outage; satu sumber gagal tidak mematikan sumber lain.
- Filter penerbit pada daftar berita; status koneksi, jumlah berita, dan pemeriksaan terakhir per penerbit pada `/tentang#sumber`.
- Beranda/daftar berita memeriksa metadata `/api/status` setiap 60 detik saat tab aktif. Revisi konten baru memunculkan tombol muat ulang, bukan me-refresh otomatis saat pembaca membaca.
- Halaman kosong/404/privasi/sumber. Tidak ada skor live, klasemen fiktif, akun, CMS, atau newsletter semu.

## Development
Node.js >=24.

    cd /root/web
    npm ci
    npm run dev

Default listen: `127.0.0.1:4317`. Environment: HOST, PORT, DATA_DIR, REFRESH_INTERVAL_MS (default 300000; minimum 1000, interval kecil hanya untuk pengujian).
Konfigurasi penerbit, feed, dan allowlist gambar/tautan ada di `src/sources.ts`. Scheduler menunggu 5 menit setelah siklus selesai agar tidak overlap. Request timeout 12 detik; satu retry hanya untuk koneksi terputus sementara, tetap dalam deadline awal. Conditional ETag/Last-Modified dipakai jika tersedia. Tidak ada endpoint publik untuk memaksa refresh.

## Tests

    npm test
    npm run typecheck
    npm run build
    npm run test:e2e
    node scripts/security-scan.mjs
    npm audit --omit=dev

Playwright memakai server sementara port 4318 dan RSS nyata. Unit/integration tests memakai fixture khusus pengujian dan tidak menulis berita contoh ke produksi.
Untuk menguji situs yang sudah deploy:

    TEST_BASE_URL=http://5.189.131.6 npm run test:e2e

Untuk membuktikan satu siklus otomatis pada layanan aktif tanpa restart atau trigger manual:

    node scripts/verify-auto-update.mjs

Perintah menunggu foreground hingga sekitar 6 menit dan menulis bukti `qa/automatic-cycle.json`. Status kesehatan multisumber ada di `/healthz` dan `/api/status` (no-store); informasi sumber yang gagal terlihat di `/tentang#sumber` dan log layanan.

## Branding
Nama publik resmi: `lekakick` (huruf kecil). Nama layanan, direktori deployment/cache, dan key localStorage `garisbola.saved.v1` sengaja dipertahankan sebagai identifier internal agar deployment dan bookmark pembaca tidak terputus saat perubahan merek.

## Production (Cloudflare Pages + GitHub Actions)
Situs berupa berkas statis di Cloudflare Pages, dibangun ulang oleh `.github/workflows/publish.yml` tiap 30 menit:

1. `node dist/publish.js out` mengambil RSS (arsip `data/feeds.json` disimpan di cache Actions), menulis paling banyak satu rangkuman AI, lalu mengekspor seluruh halaman ke `out/` (`src/static.ts`).
2. `data/digests.json` (arsip artikel) di-commit ke repo bila berubah — riwayat git sekaligus menjadi backup.
3. Bila ada artikel baru (atau workflow dijalankan manual/push ke main), `out/` diunggah dengan `wrangler pages deploy`.

Yang tetap butuh kode server ada di `functions/` (Pages Functions, lihat `_routes.json`): pengalihan alamat lama `/artikel?kategori=…`, 410 untuk `/berita/*`, dan formulir laporan `/api/lapor`. Laporan pembaca tersimpan di KV namespace dengan binding `LAPORAN` (Cloudflare → Workers & Pages → KV).

Pengaturan di GitHub → Settings → Secrets and variables → Actions:
- Secrets: `DEEPSEEK_API_KEY`, `CLOUDFLARE_API_TOKEN` (izin *Cloudflare Pages: Edit*), `CLOUDFLARE_ACCOUNT_ID`.
- Variables (opsional): `DEEPSEEK_MODEL` (bawaan `deepseek-v4-pro`), `DIGEST_DAILY_LIMIT` (bawaan 12).

Uji lokal persis seperti di Cloudflare:

    npm run build
    DATA_DIR=data node dist/publish.js out --tanpa-ai
    npx wrangler pages dev out --kv LAPORAN

Menghapus artikel: hapus entrinya dari `data/digests.json`, commit ke main; workflow akan menerbitkan ulang.
`src/server.ts` + `deploy/` (Node + Nginx di VPS) masih bisa dipakai untuk server biasa.

## Batasan konten
Ini aggregator RSS, bukan penerbit artikel penuh. Berita/foto tetap milik sumber. Penggunaan komersial harus mengikuti lisensi penerbit. Kategori berbasis kata kunci; tidak selalu sempurna. Arsip dibatasi 1200 artikel (mempertahankan hingga 100 artikel nyata per penerbit, lalu mengisi dengan berita terbaru), sehingga bookmark lama dapat kedaluwarsa. Waktu terbit mengikuti RSS penerbit; tidak seluruh isi website penerbit tersedia di RSS. Tidak melakukan scraping artikel lengkap atau melewati paywall.
Tidak ada kredensial, pembayaran, atau data pengguna di server. Bacaan tersimpan lokal di browser.
