import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';

test('SIGTERM menunggu refresh lambat selesai dan cache tersimpan',async()=>{
  const dir=await mkdtemp(`${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/slow-shutdown-`);
  const listener=createServer();
  await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=(listener.address() as AddressInfo).port;
  await new Promise<void>(resolve=>listener.close(()=>resolve()));
  const preload=`${dir}/preload.mjs`;
  await writeFile(preload,`
    const native=globalThis.setTimeout;
    const feedCount=11;
    let calls=0;
    // Percepat hanya waktu yang diuji: 11s upstream, 10s/20s shutdown.
    globalThis.setTimeout=(callback,ms,...args)=>native(callback,[1000,10000,20000].includes(ms)?ms/10:ms,...args);
    globalThis.fetch=async()=>{
      calls++;
      const slow=calls>feedCount;
      if(calls===feedCount+1)console.log('SLOW_REFRESH_ACTIVE');
      if(slow)await new Promise(resolve=>native(resolve,1100));
      return new Response('<rss><channel><item><title>'+(slow?'Sesudah refresh':'Sebelum refresh')+'</title><link>https://www.antaranews.com/berita/1/berita</link><pubDate>Thu, 08 Oct 2026 12:00:00 +0700</pubDate></item></channel></rss>');
    };
  `);
  const child=spawn(process.execPath,['--import','tsx','--import',preload,'src/server.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:dir,REFRESH_INTERVAL_MS:'1000'},stdio:['ignore','pipe','pipe']});
  let output='',signaled=false,timedOut=false;
  const limit=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},8000);
  child.stdout.on('data',data=>{
    output+=data;
    if(!signaled && output.includes('SLOW_REFRESH_ACTIVE')){signaled=true;child.kill('SIGTERM');}
  });
  child.stderr.on('data',data=>{output+=data;});
  try{
    const code=await new Promise<number|null>((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
    assert.equal(timedOut,false,output);
    assert.equal(signaled,true,output);
    assert.equal(code,0,'graceful shutdown tidak dipotong sebelum timeout RSS');
    const cache=JSON.parse(await readFile(`${dir}/feeds.json`,'utf8'));
    assert.ok(cache.feeds.some((feed:{xml:string})=>feed.xml.includes('Sesudah refresh')),'cache siklus terakhir tersimpan');
  }finally{clearTimeout(limit);child.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
});
