import { test, expect } from '@playwright/test';

test('pembaruan muncul tanpa memuat ulang bacaan sampai dipilih pembaca', async ({page}) => {
  await page.clock.install();
  // Ubah hanya metadata revisi HTML fixture; isi berita tetap dari server uji.
  await page.route('**/artikel?kategori=timnas', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/data-news-revision="[^"]*"/, 'data-news-revision="revision-awal"');
    await route.fulfill({response,body});
  });
  let statusRequests = 0;
  let changed = false;
  await page.route('**/api/status', async route => {
    statusRequests++;
    await route.fulfill({json:{revision:changed ? 'revision-baru' : 'revision-awal',updatedAt:'2026-10-08T12:00:00.000Z',degraded:false}});
  });
  await page.goto('/artikel?kategori=timnas');
  const update = page.getByRole('button',{name:'Tampilkan berita terbaru'});
  await expect(update).toBeHidden();
  await page.clock.runFor(61_000);
  await expect.poll(()=>statusRequests).toBeGreaterThan(0);
  await expect(update).toBeHidden();
  changed = true;
  await page.clock.runFor(61_000);
  await expect(update).toBeVisible();
  await expect(page).toHaveURL(/kategori=timnas/);
  await expect(page.locator('body')).toHaveAttribute('data-news-revision','revision-awal');
  await Promise.all([page.waitForEvent('load'),update.click()]);
  await expect(page).toHaveURL(/kategori=timnas/);
  await expect(update).toBeHidden();
});

test('kegagalan jaringan pemeriksaan tidak menghapus berita atau memunculkan kabar palsu',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  await page.route('**/api/status',route=>route.abort('failed'));
  await page.goto('/');
  const headline=await page.locator('.lead-story h2').innerText();
  await page.clock.runFor(61_000);
  await expect(page.locator('.lead-story h2')).toHaveText(headline);
  await expect(page.getByRole('button',{name:'Tampilkan berita terbaru'})).toBeHidden();
  expect(errors).toEqual([]);
});
