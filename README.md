# lekakick

Portal kurasi berita sepak bola berbahasa Indonesia. Source workspace: `/root/web`.
Deployment: `/opt/garisbola`. Public URL: `http://5.189.131.6/`.

## Fitur
- Beranda editorial responsif, berita utama, kategori, pencarian, pagination.
- Halaman ringkasan RSS dengan atribusi ANTARA, waktu terbit asli, kredit foto, dan tautan laporan lengkap.
- Bacaan saya memakai localStorage; bagikan via Web Share/clipboard dengan dialog salin sebagai fallback HTTP.
- SSR HTML, metadata Open Graph, font lokal, CSP, input escaping, URL allowlist, pembatasan RSS.
- Empat feed ANTARA diperiksa setiap 10 menit. Cache disk atomik bertahan saat restart/outage.
- Halaman kosong/404/privasi/sumber. Tidak ada skor live, klasemen fiktif, akun, CMS, atau newsletter semu.

## Development
Node.js >=24.

    cd /root/web
    npm ci
    npm run dev

Default listen: `127.0.0.1:4317`. Environment: HOST, PORT, DATA_DIR.

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

## Branding
Nama publik resmi: `lekakick` (huruf kecil). Nama layanan, direktori deployment/cache, dan key localStorage `garisbola.saved.v1` sengaja dipertahankan sebagai identifier internal agar deployment dan bookmark pembaca tidak terputus saat perubahan merek.

## Production
Nginx HTTP :80 -> Node 127.0.0.1:4317. Layanan systemd DynamicUser, ProtectHome, read-only application, memory/CPU limits, restart-on-failure, enabled at boot.
Cache: `/var/lib/garisbola/feeds.json`. Hanya direktori ini yang dapat ditulis aplikasi.
Config: `/etc/systemd/system/garisbola.service` dan `/etc/nginx/sites-available/garisbola`.

    systemctl status garisbola nginx
    journalctl -u garisbola -n 50 --no-pager
    curl http://127.0.0.1:4317/healthz

Untuk pembaruan aplikasi setelah tes lolos:

    npm run build
    cp -a dist views public package.json package-lock.json /opt/garisbola/
    npm ci --omit=dev --ignore-scripts --prefix /opt/garisbola
    systemctl restart garisbola
    curl --retry 10 --retry-connrefused --retry-delay 2 --fail http://127.0.0.1:4317/healthz

Config deploy tersimpan di `deploy/`; validasi `nginx -t` sebelum reload. Layanan bot lain tidak perlu disentuh.
Domain belum diberikan; HTTPS belum dikonfigurasi. Setelah domain mengarah ke IP VPS, ubah server_name, pasang sertifikat tepercaya/auto-renew, redirect HTTP ke HTTPS, lalu aktifkan HSTS hanya setelah TLS tervalidasi.

## Batasan konten
Ini aggregator RSS, bukan penerbit artikel penuh. Berita/foto tetap milik sumber. Penggunaan komersial harus mengikuti lisensi penerbit. Kategori berbasis kata kunci; tidak selalu sempurna. Arsip terbatas pada feed tersimpan (maksimum 300 item), sehingga bookmark lama dapat kedaluwarsa.
Tidak ada kredensial, pembayaran, atau data pengguna di server. Bacaan tersimpan lokal di browser.
