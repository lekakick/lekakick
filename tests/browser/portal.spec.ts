import { test, expect } from '@playwright/test';

test('beranda responsif dan pembaca dapat mencari berita serta membuka sumber', async ({page}) => {
  const errors:string[]=[];
  page.on('pageerror',error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Bola terus');
  await expect(page.locator('.lead-story h2 a')).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({width,height:900});
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    expect(fits, `Overflow at ${width}px`).toBeTruthy();
  }
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('searchbox').fill('Timnas');
  await page.getByRole('button',{name:'Cari',exact:true}).click();
  await expect(page).toHaveURL(/q=Timnas/);
  await expect(page.locator('.news-card').first()).toBeVisible();
  await page.locator('.news-card h3 a').first().click();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('link',{name:'Baca selengkapnya di ANTARA'})).toHaveAttribute('href', /^https:\/\/www\.antaranews\.com\/berita\//);
  expect(errors).toEqual([]);
});
