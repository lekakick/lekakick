import { test, expect } from '@playwright/test';

const storageKey = 'garisbola.saved.v1';

test('hapus hanya bookmark yang dipastikan tidak tersedia dan bebaskan kuota simpan', async ({page, request}) => {
  await page.goto('/artikel');
  const saveButtons = page.locator('.news-card [data-save]');
  await expect(saveButtons.nth(1)).toBeVisible();
  const availableId = await saveButtons.nth(0).getAttribute('data-save');
  const laterId = await saveButtons.nth(1).getAttribute('data-save');
  expect(availableId).toMatch(/^[a-f0-9]{16}$/);
  expect(laterId).toMatch(/^[a-f0-9]{16}$/);

  const expiredIds = Array.from({length: 100}, (_, index) => index.toString(16).padStart(16, '0'));
  const response = await request.get('/api/artikel.json');
  expect(response.ok()).toBeTruthy();
  const {items} = await response.json() as {items: {id: string}[]};
  expect(items.some(item => expiredIds.includes(item.id))).toBeFalsy();

  await page.evaluate(({key, ids}) => localStorage.setItem(key, JSON.stringify(ids)), {key: storageKey, ids: expiredIds});
  await page.goto('/simpan');
  await expect(page.locator('#saved-status')).toContainText('100 berita sudah tidak tersedia');
  await expect(page.locator('#saved-grid .news-card')).toHaveCount(0);
  const clear = page.getByRole('button', {name: 'Hapus bacaan yang tidak tersedia', exact: true});
  await expect(clear).toBeVisible();
  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#saved-status')).toContainText('Belum ada bacaan tersimpan');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), storageKey)).toEqual([]);
  await expect(clear).toHaveCount(0);

  await page.goto('/artikel');
  const save = page.locator(`[data-save="${availableId}"]`);
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), storageKey)).toEqual([availableId]);

  // Keep available bookmarks and IDs added after the API snapshot, even if not yet checked.
  await page.evaluate(({key, ids}) => localStorage.setItem(key, JSON.stringify(ids)), {
    key: storageKey, ids: [availableId, expiredIds[0]],
  });
  await page.goto('/simpan');
  await expect(page.locator('#saved-grid .news-card')).toHaveCount(1);
  await expect(page.locator('#saved-status')).toContainText('1 berita sudah tidak tersedia');
  await expect(clear).toBeVisible();
  await page.evaluate(({key, ids}) => localStorage.setItem(key, JSON.stringify(ids)), {
    key: storageKey, ids: [availableId, expiredIds[0], laterId, expiredIds[1]],
  });
  await clear.click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), storageKey))
    .toEqual([availableId, laterId, expiredIds[1]]);
  await expect(page.locator('#saved-grid .news-card')).toHaveCount(2);
  await expect(page.locator('#saved-status')).toContainText('1 berita sudah tidak tersedia');
});
