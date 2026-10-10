import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { fixtureDigests } from './app.test.js';

test('status pembaruan tidak dicache, revisi mengikuti artikel, dan halaman tentang memuat sumber',async()=>{
 const snapshot={items:[],updatedAt:'2026-10-08T05:00:00.000Z',lastAttemptAt:'2026-10-08T05:00:00.000Z',degraded:false,revision:'abc123',refreshIntervalMs:300000,sources:[{id:'detik',name:'detikSport',homepage:'https://sport.detik.com/sepakbola',status:'ok',articleCount:13,feedCount:2,healthyFeeds:2,lastSuccessAt:'2026-10-08T05:00:00.000Z',lastAttemptAt:'2026-10-08T05:00:00.000Z'}]};
 let digests=fixtureDigests.slice(1);
 const app=createApp({snapshot:()=>snapshot} as any,{list:()=>digests}),server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  const statusRes=await fetch(base+'/api/status');
  assert.equal(statusRes.status,200); assert.equal(statusRes.headers.get('cache-control'),'no-store');
  const data=await statusRes.json();assert.equal(data.feedRevision,'abc123');assert.equal(data.refreshIntervalMs,300000);assert.equal(data.sources[0].name,'detikSport');assert.equal(data.items,undefined);
  const home=await(await fetch(base)).text();
  assert.ok(home.includes(`data-news-revision="${data.revision}"`),'revisi halaman sama dengan status');
  digests=fixtureDigests;
  const next=await(await fetch(base+'/api/status')).json();
  assert.notEqual(next.revision,data.revision,'artikel baru mengubah revisi');
  const about=await(await fetch(base+'/tentang')).text();assert.ok(about.includes('detikSport'));assert.ok(about.includes('Bola.com'));assert.ok(about.includes('Tempo'));assert.ok(!about.includes('Cuplikan RSS'));
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
