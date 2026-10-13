import { legacyListingTarget } from '../../edge/site.js';

// /artikel?kategori=…&halaman=…&q=… (alamat lama) → path statis; tanpa query → berkas artikel.html.
export const onRequestGet = ({request, next}) => {
  const url = new URL(request.url);
  const target = legacyListingTarget(url.searchParams);
  return target ? Response.redirect(new URL(target, url).toString(), 301) : next();
};
