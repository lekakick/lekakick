import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage();
  await page.goto('http://5.189.131.6/');
  await page.locator('.lead-story h2 a').click();
  const source = page.getByRole('link',{name:/Baca selengkapnya di /});
  const sourceURL = new URL(await source.getAttribute('href'));
  assert.equal(sourceURL.protocol,'https:');
  assert.ok(['www.antaranews.com','sport.detik.com','www.bola.com','www.tempo.co'].includes(sourceURL.hostname));
  const mobile = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(mobile.violations,[]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await page.screenshot({path:'qa/article-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  const desktop = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(desktop.violations,[]);
  await page.screenshot({path:'qa/article-desktop.png',fullPage:true});
  const report = {url:page.url(),title:await page.locator('h1').innerText(),source:await source.getAttribute('href'),mobileViolations:mobile.violations.length,desktopViolations:desktop.violations.length,verifiedAt:new Date().toISOString()};
  await writeFile('qa/detail-verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
