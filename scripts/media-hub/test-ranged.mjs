import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';import {createRequire} from 'node:module';
const {probe,RangedItem,dispositionName}=createRequire(import.meta.url)('./ranged-download.cjs');
// Acts like AnimeKaizoku's file server: a whole-file request, or a range bigger than it manages, fails with error 1101
const MB=1024*1024,body=crypto.randomBytes(37*MB+12345);
const serve=(opts={})=>new Promise(resolve=>{let hits=0;const server=http.createServer((req,res)=>{
 const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||''),a=m?+m[1]:0,b=m&&m[2]?+m[2]:body.length-1;hits++;
 if(!m||!m[2]||b-a+1>(opts.limit||20*MB)||opts.fail?.(hits)){res.writeHead(500,{'content-type':'text/plain'});return res.end('error code: 1101')}
 res.writeHead(206,{'content-type':'application/zip','content-range':`bytes ${a}-${b}/${body.length}`,'content-disposition':"attachment; filename*=UTF-8''%5BAnimeKaizoku%5D%20Show%E2%80%99s%20Season.zip"});
 res.end(body.subarray(a,b+1));
});server.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}/download/enc:abc`}))});
const fetcher=(url,headers,signal)=>fetch(url,{headers,signal});
const tmp=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'seanime-ranged-test-')),'file.zip');
const item=(url,file)=>{const it=new RangedItem(fetcher,url,'a.zip',body.length);it.wait=()=>1;it.setSavePath(file);return it};
const done=it=>new Promise(resolve=>it.once('done',(_,state)=>resolve(state)));

test('a host that only serves ranges is downloaded in pieces',async()=>{
 const {server,url}=await serve();
 try{
  const info=await probe(fetcher,url);assert.deepEqual(info,{name:'[AnimeKaizoku] Show’s Season.zip',total:body.length});
  const file=tmp(),it=item(url,file),end=done(it);it.begin();
  assert.equal(await end,'completed');assert.equal(it.getReceivedBytes(),body.length);assert.ok(fs.readFileSync(file).equals(body));
 }finally{server.close()}
});

test('pieces shrink when the busy server only manages small ranges',async()=>{
 const {server,url}=await serve({limit:1.5*MB});
 try{const file=tmp(),it=item(url,file),end=done(it);it.begin();assert.equal(await end,'completed');assert.ok(fs.readFileSync(file).equals(body))}
 finally{server.close()}
});

test('pause and resume keep the file whole',async()=>{
 const {server,url}=await serve();
 try{
  const file=tmp(),it=item(url,file),end=done(it);it.begin();
  await new Promise(r=>setTimeout(r,5));it.pause();assert.ok(it.isPaused()&&it.canResume());
  await new Promise(r=>setTimeout(r,100));it.resume();
  assert.equal(await end,'completed');assert.ok(fs.readFileSync(file).equals(body));
 }finally{server.close()}
});

test('a server that stops answering stalls the download, which starts again by itself and finishes',async()=>{
 let down=true;const {server,url}=await serve({fail:n=>n>2&&down});
 try{
  const file=tmp(),it=item(url,file);it.retryAfter=50;const end=done(it);
  const stalled=new Promise(r=>it.on('updated',(_,s)=>s==='interrupted'&&r()));it.begin();
  await stalled;assert.ok(it.canResume());assert.match(it.problem,/not answering/);down=false;
  assert.equal(await end,'completed');assert.ok(fs.readFileSync(file).equals(body));
 }finally{server.close()}
});

test('a server error page is reported',async()=>{
 const bad=await serve({fail:()=>true});
 try{await assert.rejects(probe(fetcher,bad.url,2,()=>1),/HTTP 500, error code: 1101/)}finally{bad.server.close()}
 assert.equal(dispositionName('attachment; filename="Ep 01.mkv"'),'Ep 01.mkv');
});
