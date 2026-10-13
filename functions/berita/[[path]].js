import { legacyListingTarget } from '../../edge/site.js';

// Halaman ringkasan RSS lama: daftar dialihkan 301, detail dijawab 410 agar mesin pencari membuangnya.
export const onRequestGet = async ({request, params, env}) => {
  const url = new URL(request.url);
  if (!params.path?.length) return Response.redirect(new URL(legacyListingTarget(url.searchParams) ?? '/artikel', url).toString(), 301);
  const page = await env.ASSETS.fetch(new URL('/410', url));
  return new Response(page.body, {status: 410, headers: {'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex'}});
};
