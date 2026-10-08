import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

test('halaman utama lolos audit aksesibilitas dan aset lokal termuat', async ({page}) => {
  await mkdir('/root/.hermes/cache/scratch/garisbola-qa',{recursive:true});
  const errors:string[]=[];
  page.on('pageerror',error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const assets = await page.evaluate(() => ({
    fonts:document.fonts.check('700 32px Barlow') && document.fonts.check('400 14px "DM Sans"'),
    hero:document.querySelector<HTMLImageElement>('.lead-image')?.naturalWidth,
  }));
  expect(assets.fonts).toBeTruthy();
  expect(assets.hero).toBeGreaterThan(0);
  await page.setViewportSize({width:1440,height:1050});
  await page.screenshot({path:'/root/.hermes/cache/scratch/garisbola-qa/desktop.png',fullPage:true});
  const desktop = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(desktop.violations).toEqual([]);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/root/.hermes/cache/scratch/garisbola-qa/mobile.png',fullPage:true});
  const mobile = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(mobile.violations).toEqual([]);
  for (const route of ['/berita','/simpan','/tentang','/privasi']) {
    await page.goto(route);
    const result = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(result.violations,route).toEqual([]);
  }
  expect(errors).toEqual([]);
});
