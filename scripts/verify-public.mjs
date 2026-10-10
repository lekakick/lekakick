import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://5.189.131.6';
const routes = ['/', '/berita', '/berita?kategori=timnas', '/berita?kategori=liga-indonesia', '/berita?kategori=internasional', '/berita?kategori=transfer', '/berita?q=zzzzzz', '/berita?sumber=antara', '/berita?sumber=detik', '/berita?sumber=bola', '/berita?sumber=tempo', '/simpan', '/tentang', '/privasi', '/assets/styles.css?v=2', '/assets/app.js?v=4', '/assets/favicon.svg', '/robots.txt', '/healthz', '/api/status'];
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
assert.equal(health.refreshIntervalMs,300000);
assert.deepEqual(health.sources.map(source=>source.id).sort(),['antara','bola','detik','tempo']);
for(const source of health.sources){
  assert.equal(source.status,'ok',source.name);
  assert.ok(source.articleCount>0,source.name);
  assert.equal(source.healthyFeeds,source.feedCount,source.name);
}
assert.equal(health.sources.reduce((sum,source)=>sum+source.articleCount,0),health.articles);
assert.ok(health.revision);
const report = {verifiedAt:new Date().toISOString(),base,routes:results,health};
await writeFile('verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
