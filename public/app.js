'use strict';
const STORAGE_KEY = 'garisbola.saved.v1';
let toastTimer;
function notify(message) {
  const target = document.getElementById('toast');
  if (!target) return;
  target.textContent = message;
  target.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { target.hidden = true; }, 3500);
}
function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id)))].slice(0,100) : [];
  } catch { return []; }
}
function syncButtons() {
  const ids = readSaved();
  document.querySelectorAll('[data-save]').forEach(button => {
    const saved = ids.includes(button.dataset.save);
    button.setAttribute('aria-pressed', String(saved));
    const label = button.querySelector('[data-save-label]');
    if (label) label.textContent = saved ? 'Tersimpan' : 'Simpan';
  });
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function savedCard(item) {
  const card = element('article', 'news-card');
  const imageLink = element('a', 'card-image');
  imageLink.href = item.path;
  imageLink.tabIndex = -1;
  imageLink.setAttribute('aria-hidden', 'true');
  const image = element('img');
  image.src = item.image || '/assets/placeholder.svg';
  image.alt = ''; image.loading = 'lazy'; image.width = 800; image.height = 533;
  image.addEventListener('error', () => { image.src = '/assets/placeholder.svg'; }, {once:true});
  imageLink.append(image);
  const content = element('div','card-content');
  const meta = element('div','article-meta');
  meta.append(element('span','category-label',item.categoryLabel),element('span','',item.dateLabel));
  const heading = element('h3');
  const link = element('a','',item.title); link.href = item.path; heading.append(link);
  const bottom = element('div','card-bottom');
  const remove = element('button','button button-outline','Hapus');
  remove.dataset.save = item.id;
  remove.setAttribute('aria-label', `Hapus dari bacaan: ${item.title}`);
  remove.setAttribute('aria-pressed','true');
  bottom.append(element('span','',item.source),remove);
  content.append(meta,heading,element('p','card-excerpt',item.excerpt),bottom);
  card.append(imageLink,content);
  return card;
}
let savedRequest = 0;
async function loadSaved() {
  const grid = document.getElementById('saved-grid');
  const status = document.getElementById('saved-status');
  if (!grid || !status) return;
  const request = ++savedRequest;
  document.getElementById('clear-unavailable')?.remove();
  const ids = readSaved();
  if (!ids.length) {
    grid.replaceChildren();
    status.textContent = 'Belum ada bacaan tersimpan. Tekan ikon bookmark pada berita untuk menyimpannya.';
    return;
  }
  try {
    const response = await fetch(`/api/berita?ids=${encodeURIComponent(ids.join(','))}`);
    if (!response.ok) throw new Error('Gagal memuat bacaan');
    const data = await response.json();
    if (request !== savedRequest) return;
    grid.replaceChildren(...data.items.map(savedCard));
    const available = new Set(data.items.map(item => item.id));
    const missing = new Set(ids.filter(id => !available.has(id)));
    status.textContent = `${data.items.length} berita tersimpan.${missing.size ? ` ${missing.size} berita sudah tidak tersedia di arsip RSS.` : ''}`;
    if (missing.size) {
      const clear = element('button', 'button button-outline', 'Hapus bacaan yang tidak tersedia');
      clear.id = 'clear-unavailable';
      clear.type = 'button';
      clear.addEventListener('click', () => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(readSaved().filter(id => !missing.has(id))));
        } catch { notify('Browser tidak mengizinkan penyimpanan. Coba nonaktifkan mode privat.'); return; }
        syncButtons();
        void loadSaved();
      });
      status.after(clear);
    }
    syncButtons();
  } catch {
    if (request === savedRequest) status.textContent = 'Bacaan belum dapat dimuat. Periksa koneksi lalu muat ulang halaman.';
  }
}
document.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest('[data-save]') : null;
  if (!button) return;
  const id = button.dataset.save;
  if (!id || !/^[a-f0-9]{16}$/.test(id)) return;
  const ids = readSaved();
  const exists = ids.includes(id);
  if (!exists && ids.length >= 100) { notify('Maksimal 100 bacaan. Hapus satu untuk menyimpan berita lain.'); return; }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exists ? ids.filter(value => value !== id) : [...ids,id]));
  } catch { notify('Browser tidak mengizinkan penyimpanan. Coba nonaktifkan mode privat.'); return; }
  syncButtons();
  notify(exists ? 'Berita dihapus dari bacaan saya.' : 'Berita disimpan ke bacaan saya.');
  void loadSaved();
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key === null) { syncButtons(); void loadSaved(); }
});
syncButtons();
void loadSaved();
function showShareDialog() {
  let dialog = document.getElementById('share-dialog');
  if (!dialog) {
    dialog = element('dialog','share-dialog');
    dialog.id = 'share-dialog';
    dialog.setAttribute('aria-labelledby','share-title');
    const heading = element('h2','', 'Bagikan kabar bola.'); heading.id = 'share-title';
    const label = element('label','', 'Tautan berita'); label.htmlFor = 'share-url';
    const input = element('input'); input.id = 'share-url'; input.readOnly = true; input.type = 'url';
    const description = element('p','', 'Pilih tautan, lalu salin untuk dibagikan.');
    const close = element('button','button button-dark','Tutup');
    close.addEventListener('click', () => dialog.close());
    dialog.append(heading,description,label,input,close);
    document.body.append(dialog);
  }
  dialog.querySelector('input').value = window.location.href;
  dialog.showModal();
  dialog.querySelector('input').select();
}
document.querySelector('[data-share]')?.addEventListener('click', async () => {
  if (navigator.share) {
    try { await navigator.share({title:document.title,url:window.location.href}); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(window.location.href); notify('Tautan berita berhasil disalin.'); return; }
    catch { /* HTTP atau izin browser bisa menolak clipboard. */ }
  }
  showShareDialog();
});
document.querySelectorAll('img').forEach(image => {
  image.addEventListener('error', () => {
    if (!image.src.endsWith('/assets/placeholder.svg')) image.src = '/assets/placeholder.svg';
  }, {once:true});
});
