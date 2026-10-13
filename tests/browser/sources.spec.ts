import { test, expect } from '@playwright/test';

const publishers = ['antara','detik','bola','tempo'];
test('halaman ringkasan RSS lama dihapus dan status sumber tetap transparan',async({page, request})=>{
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 const old = await request.get('/berita/1234567890abcdef/judul-lama');
 expect(old.status()).toBe(410);
 expect(await old.text()).toContain('noindex');
 await page.goto('/berita?kategori=timnas&sumber=detik');
 await expect(page).toHaveURL(/\/artikel\/kategori\/timnas$/);
 await expect(page.locator('.news-card').first()).toBeVisible();
 for(const label of await page.locator('.news-card .category-label').allTextContents())expect(label.trim()).toBe('Timnas');
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`).toBeTruthy();
 }
 await page.goto('/tentang#sumber');
 for(const id of publishers) await expect(page.locator(`[data-publisher="${id}"]`)).toBeVisible();
 await expect(page.locator('body')).not.toContainText('Cuplikan RSS');
 expect(errors).toEqual([]);
});
