#!/bin/sh
# Backup harian data lekakick: artikel (digests.json), laporan pembaca, arsip RSS, dan konfigurasi Nginx.
# Pulihkan dengan: tar -xzf <arsip> -C /tmp/pulih, lalu salin berkasnya ke /var/lib/private/garisbola
# saat service berhenti (systemctl stop garisbola), samakan pemiliknya, lalu jalankan lagi.
set -eu
SRC=/var/lib/private/garisbola
DEST=/var/backups/lekakick
KEEP_DAYS=30
STAMP=$(date +%Y-%m-%d)
umask 077
mkdir -p "$DEST"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
for file in digests.json laporan.jsonl feeds.json; do
  [ -f "$SRC/$file" ] && cp -p "$SRC/$file" "$WORK/"
done
cp -p /etc/nginx/sites-available/garisbola "$WORK/nginx-garisbola.conf" 2>/dev/null || true
[ -f "$WORK/digests.json" ] || { echo "digests.json tidak ditemukan, backup dibatalkan" >&2; exit 1; }
tar -czf "$DEST/lekakick-$STAMP.tar.gz.tmp" -C "$WORK" .
mv "$DEST/lekakick-$STAMP.tar.gz.tmp" "$DEST/lekakick-$STAMP.tar.gz"
find "$DEST" -name 'lekakick-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup tersimpan: $DEST/lekakick-$STAMP.tar.gz ($(du -h "$DEST/lekakick-$STAMP.tar.gz" | cut -f1))"
