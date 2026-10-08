import { test, expect } from '@playwright/test';

test('simpan berita, muat ulang, dan hapus dari bacaan saya', async ({page}) => {
  await page.goto('/berita');
  const first = page.locator('.news-card').first();
  const title = await first.locator('h3').innerText();
  await first.locator('[data-save]').click();
  await expect(first.locator('[data-save]')).toHaveAttribute('aria-pressed','true');
  await page.goto('/simpan');
  await expect(page.locator('#saved-grid h3')).toHaveText([title]);
  await page.reload();
  await expect(page.locator('#saved-grid h3')).toHaveText([title]);
  await page.locator('#saved-grid [data-save]').click();
  await expect(page.locator('#saved-grid .news-card')).toHaveCount(0);
  await expect(page.locator('#saved-status')).toContainText('Belum ada bacaan tersimpan');
});
