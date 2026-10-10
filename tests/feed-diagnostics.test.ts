import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { NewsStore } from '../src/store.js';
import { FEEDS } from '../src/sources.js';

test('kegagalan feed dicatat dengan URL tetap dan kode aman tanpa isi respons',async t=>{
  const dir=await mkdtemp(`${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/feed-diagnostics-`);
  const warnings:string[]=[];
  t.mock.method(console,'warn',(...args:unknown[])=>warnings.push(args.join(' ')));
  let step=0;
  const store=new NewsStore({dataDir:dir,feeds:[FEEDS[4]!],fetch:async()=>{
    step++;
    if(step===1)return new Response('upstream-secret-body',{status:503});
    throw new TypeError('private-upstream-message',{cause:{code:'ECONNRESET',message:'secret detail'}});
  }});
  try{
    await store.init();
    await store.refresh();
    assert.equal(warnings.length,2);
    assert.ok(warnings[0]!.includes('detik'));
    assert.ok(warnings[0]!.includes(FEEDS[4]!.url));
    assert.ok(warnings[0]!.includes('HTTP 503'));
    assert.ok(warnings[1]!.includes('ECONNRESET'));
    assert.doesNotMatch(warnings.join(' '),/secret|private-upstream/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
