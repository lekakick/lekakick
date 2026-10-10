import { test, expect } from '@playwright/test';

test('beranda responsif dan pembaca dapat mencari artikel serta menelusuri sumbernya', async ({page}) => {
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
  await expect(page).toHaveURL(/\/artikel\?q=Timnas/);
  await expect(page.locator('.news-card').first()).toBeVisible();
  await page.locator('.news-card h3 a').first().click();
  await expect(page).toHaveURL(/\/artikel\/[a-f0-9]{16}\//);
  await expect(page.locator('h1')).toBeVisible();
  const sources = page.locator('.digest-source-list a');
  expect(await sources.count()).toBeGreaterThanOrEqual(2);
  for (const href of await sources.evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href))) {
    const url = new URL(href);
    expect(url.protocol).toBe('https:');
    expect(['www.antaranews.com','sport.detik.com','www.bola.com','www.tempo.co']).toContain(url.hostname);
  }
  expect(errors).toEqual([]);
});
