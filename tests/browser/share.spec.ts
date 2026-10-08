import { test, expect } from '@playwright/test';

test('bagikan menyediakan tautan yang dapat disalin meskipun clipboard tidak tersedia', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator,'share',{value:undefined,configurable:true});
    Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
  });
  await page.goto('/');
  await page.locator('.lead-story h2 a').click();
  await page.getByRole('button',{name:'Bagikan'}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Tautan berita')).toHaveValue(page.url());
  await dialog.getByRole('button',{name:'Tutup'}).click();
  await expect(dialog).not.toBeVisible();
});
