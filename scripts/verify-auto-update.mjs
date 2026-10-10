import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://5.189.131.6';
async function status() {
  const response = await fetch(`${base}/api/status`, {cache:'no-store',signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  return response.json();
}
const before = await status();
assert.equal(before.refreshIntervalMs,300000);
assert.equal(before.sources.length,4);
const deadline = Date.now()+before.refreshIntervalMs+45000;
let after=before;
console.log(`Menunggu siklus otomatis setelah ${before.lastAttemptAt}; tanpa restart atau trigger refresh.`);
while(Date.now()<deadline){
  await new Promise(resolve=>setTimeout(resolve,5000));
  after=await status();
  if(Date.parse(after.updatedAt)>Date.parse(before.updatedAt) && Date.parse(after.lastAttemptAt)>Date.parse(before.lastAttemptAt))break;
}
assert.ok(Date.parse(after.updatedAt)>Date.parse(before.updatedAt),'pemeriksaan sumber selesai tanpa trigger manual');
assert.ok(Date.parse(after.lastAttemptAt)>Date.parse(before.lastAttemptAt),'scheduler memulai siklus berikutnya');
assert.ok(after.articles>0);
assert.deepEqual(after.sources.map(source=>source.id).sort(),['antara','bola','detik','tempo']);
assert.equal(after.sources.reduce((sum,source)=>sum+source.articleCount,0),after.articles);
assert.ok(after.sources.every(source=>source.articleCount>0));
const report={verifiedAt:new Date().toISOString(),base,automaticCycleObserved:true,before,after};
await mkdir('qa',{recursive:true});
await writeFile('qa/automatic-cycle.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
