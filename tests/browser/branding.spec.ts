import { test, expect } from '@playwright/test';

test('lekakick tampil di halaman publik dan bookmark lama tetap tersedia', async ({page}) => {
  for (const route of ['/', '/berita', '/simpan', '/tentang', '/privasi']) {
    await page.goto(route);
    await expect(page).toHaveTitle(/lekakick/);
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content','lekakick');
    await expect(page.locator('.masthead .brand')).toHaveText('lekakick.');
    await expect(page.locator('body')).not.toContainText(/garisbola/i);
  }
  await page.goto('/berita');
  const id = await page.locator('[data-save]').first().getAttribute('data-save');
  const title = await page.locator('.news-card h3').first().innerText();
  await page.evaluate(id => localStorage.setItem('garisbola.saved.v1',JSON.stringify([id])),id);
  await page.goto('/simpan');
  await expect(page.locator('#saved-grid h3')).toHaveText([title]);
  await page.locator('#saved-grid h3 a').click();
  await expect(page).toHaveTitle(/lekakick/);
  await expect(page.locator('body')).not.toContainText(/garisbola/i);
});
