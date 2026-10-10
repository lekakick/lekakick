import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { NewsStore } from '../src/store.js';
import { FEEDS } from '../src/sources.js';
const xml='<rss><channel><item><title>Kabar sepak bola</title><link>https://sport.detik.com/sepakbola/liga-indonesia/d-1/berita</link><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate></item></channel></rss>';

test('koneksi RSS terputus dicoba ulang sekali dengan deadline yang sama',async()=>{
  const dir=await mkdtemp(`${process.env.TMPDIR}/feed-transport-`);
  const signals:(AbortSignal | null | undefined)[]=[];
  const store=new NewsStore({dataDir:dir,feeds:[FEEDS[4]!],fetch:async(_url,options)=>{
    signals.push(options?.signal);
    if(signals.length===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});
    return new Response(xml);
  }});
  try{
    await store.init();
    assert.equal(store.snapshot().degraded,false);
    assert.equal(store.snapshot().items.length,1);
    assert.equal(signals.length,2);
    assert.ok(signals[0]);
    assert.equal(signals[0],signals[1],'batas 12 detik tidak direset');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('retry dibatasi dan tidak mengulangi penolakan HTTP atau XML rusak',async()=>{
  for(const mode of ['network','http429','malformed']){
    const dir=await mkdtemp(`${process.env.TMPDIR}/feed-limit-`);
    let calls=0;
    const store=new NewsStore({dataDir:dir,feeds:[FEEDS[4]!],fetch:async()=>{
      calls++;
      if(mode==='network')throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});
      if(mode==='http429')return new Response('rate limit',{status:429});
      return new Response('<rss>');
    }});
    try{
      await store.init();
      assert.equal(store.snapshot().degraded,true);
      assert.equal(calls,mode==='network'?2:1,mode);
    }finally{await rm(dir,{recursive:true,force:true});}
  }
});
