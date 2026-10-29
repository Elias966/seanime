import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {once} from 'node:events';
import WebTorrent from 'webtorrent';import {parseRange,cleanMagnet,allowedOrigin,createEngine} from './torrent-engine.mjs';
test('byte ranges support seeking, suffix ranges and reject out-of-bounds requests',()=>{
 assert.deepEqual(parseRange('bytes=20-29',100),{start:20,end:29,status:206});assert.deepEqual(parseRange('bytes=-10',100),{start:90,end:99,status:206});assert.deepEqual(parseRange('bytes=90-',100),{start:90,end:99,status:206});
 for(const r of ['bytes=100-','bytes=5-2','bytes=0-1,2-3','bytes=-','evil'])assert.equal(parseRange(r,100),null);
});
test('magnet normalization permits hashes and strips arbitrary/private-network trackers',()=>{
 const m=cleanMagnet('magnet:?xt=urn:btih:'+'a'.repeat(40)+'&tr=http://127.0.0.1/private&ws=file:///etc/passwd');assert.ok(!m.includes('127.0.0.1'));assert.ok(!m.includes('file:'));assert.ok(m.includes('opentrackr'));
 for(const u of ['file:///etc/passwd','https://example.com/torrent','magnet:?xt=evil'])assert.throws(()=>cleanMagnet(u));
});
test('torrent controls allow the app and loopback interface, and deny remote origins',()=>{
 for(const o of ['app://-','http://127.0.0.1:8767','http://localhost:43211',undefined])assert.ok(allowedOrigin(o));
 for(const o of ['null','https://evil.example','http://127.0.0.1.evil.example','file:///tmp'])assert.equal(allowedOrigin(o),false);
});
test('real local peer supplies verified bytes through seekable HTTP playback; stop keeps downloaded files',{timeout:25000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seanime-torrent-test-')),source=path.join(directory,'fixture.mp4'),content=Buffer.alloc(192*1024);for(let i=0;i<content.length;i++)content[i]=i%251;fs.writeFileSync(source,content);
 const seed=new WebTorrent({dht:false,tracker:false,utp:false}),client=new WebTorrent({dht:false,tracker:false,utp:false});const engine=createEngine({directory:path.join(directory,'downloads'),client});
 try{
  const torrent=await new Promise((resolve,reject)=>{seed.once('error',reject);seed.seed(source,{announce:[]},resolve)});
  engine.server.listen(0,'127.0.0.1');await once(engine.server,'listening');const base='http://127.0.0.1:'+engine.server.address().port;
  const hash=await engine.add({magnet:torrent.magnetURI,title:'Test movie',mode:'stream'});assert.match(hash,/^[a-f0-9]{40}$/);const receiving=client.torrents[0];receiving.addPeer('127.0.0.1:'+seed.torrentPort);if(!receiving.ready)await once(receiving,'ready');
  const r=await fetch(base+'/media-file/'+hash+'/0',{headers:{Range:'bytes=65536-65791'}});assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 65536-65791/'+content.length);assert.deepEqual(Buffer.from(await r.arrayBuffer()),content.subarray(65536,65792));
  const denied=await fetch(base+'/torrents',{headers:{Origin:'https://evil.example'}});assert.equal(denied.status,403);
  const bad=await fetch(base+'/media-file/'+hash+'/0',{headers:{Range:'bytes=999999-'}});assert.equal(bad.status,416);
  const stopped=await fetch(base+'/torrents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop',hash})});assert.equal(stopped.status,200);assert.equal(engine.snapshot().length,0);assert.ok(fs.existsSync(path.join(directory,'downloads','fixture.mp4')));
  assert.ok(fs.existsSync(path.join(directory,'downloads','metadata',hash+'.torrent')));
  await new Promise(resolve=>seed.destroy(resolve));
  const resumed=await fetch(base+'/torrents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resume',hash})});assert.equal(resumed.status,200);const restored=client.torrents[0];if(!restored.ready)await once(restored,'ready');const offline=await fetch(base+'/media-file/'+hash+'/0',{headers:{Range:'bytes=65536-65791'}});assert.equal(offline.status,206);assert.deepEqual(Buffer.from(await offline.arrayBuffer()),content.subarray(65536,65792));
 }finally{await engine.close();if(!seed.destroyed)await new Promise(resolve=>seed.destroy(resolve));fs.rmSync(directory,{recursive:true,force:true})}
});
