import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://5.189.131.6';
const routes = ['/', '/berita', '/berita?kategori=timnas', '/berita?kategori=liga-indonesia', '/berita?kategori=internasional', '/berita?kategori=transfer', '/berita?q=zzzzzz', '/simpan', '/tentang', '/privasi', '/assets/styles.css?v=1', '/assets/app.js?v=3', '/assets/favicon.svg', '/robots.txt', '/healthz'];
const results = [];
for (const route of routes) {
  const response = await fetch(base + route, {signal:AbortSignal.timeout(10000)});
  results.push({route,status:response.status});
  assert.equal(response.status,200,route);
  if(route === '/') {
    const html = await response.text();
    assert.ok(html.includes('lekakick'));
    assert.ok(!html.includes('Menunggu kabar dari lapangan.'));
  }
}
for (const route of ['/.env','/package.json','/src/app.ts','/hilang']) {
  const response = await fetch(base + route);
  results.push({route,status:response.status});
  assert.equal(response.status,404,route);
}
const health = await (await fetch(base+'/healthz')).json();
assert.ok(health.articles > 0);
assert.equal(health.degraded,false);
const report = {verifiedAt:new Date().toISOString(),base,routes:results,health};
await writeFile('verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
