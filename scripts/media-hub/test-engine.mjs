import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {once} from 'node:events';
import WebTorrent from 'webtorrent';import {parseRange,cleanMagnet,allowedOrigin,createEngine,seriesFolder,episodeOf} from './torrent-engine.mjs';
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
test('finished downloads join the library, stop seeding on their own and stay playable from disk',{timeout:25000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seanime-torrent-test-')),source=path.join(directory,'movie.mp4'),content=Buffer.alloc(160*1024);for(let i=0;i<content.length;i++)content[i]=i%241;fs.writeFileSync(source,content);
 const seed=new WebTorrent({dht:false,tracker:false,utp:false}),client=new WebTorrent({dht:false,tracker:false,utp:false});const engine=createEngine({directory:path.join(directory,'downloads'),client});
 try{
  const torrent=await new Promise((resolve,reject)=>{seed.once('error',reject);seed.seed(source,{announce:[]},resolve)});
  engine.server.listen(0,'127.0.0.1');await once(engine.server,'listening');const base='http://127.0.0.1:'+engine.server.address().port;
  const media={imdb:'tt1375666',title:'Inception',year:'2010',poster:'https://images.metahub.space/poster/medium/tt1375666/img',background:'javascript:alert(1)'};
  const hash=await engine.add({magnet:torrent.magnetURI,title:'Inception (2010) [1080p]',mode:'download',media});const receiving=client.torrents[0];receiving.addPeer('127.0.0.1:'+seed.torrentPort);
  if(receiving.progress<1)await once(receiving,'done');engine.snapshot();
  const list=await (await fetch(base+'/library')).json();assert.equal(list.length,1);assert.equal(list[0].imdb,'tt1375666');assert.equal(list[0].background,undefined);assert.equal(list[0].url,'/library-file/'+hash);
  // No seeding: the finished transfer is removed without being asked, the file stays
  for(let i=0;i<50&&(await (await fetch(base+'/torrents')).json()).length;i++)await new Promise(r=>setTimeout(r,100));
  assert.equal((await (await fetch(base+'/torrents')).json()).length,0);assert.equal(client.torrents.length,0);
  const r=await fetch(base+list[0].url,{headers:{Range:'bytes=1000-1999'}});assert.equal(r.status,206);assert.equal(r.headers.get('Content-Type'),'video/mp4');assert.deepEqual(Buffer.from(await r.arrayBuffer()),content.subarray(1000,2000));
  await fetch(base+'/torrents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'library-remove',hash})});
  assert.equal((await (await fetch(base+'/library')).json()).length,0);assert.ok(fs.existsSync(path.join(directory,'downloads','movie.mp4')));
 }finally{await engine.close();if(!seed.destroyed)await new Promise(resolve=>seed.destroy(resolve));fs.rmSync(directory,{recursive:true,force:true})}
});
test('older complete downloads are found from saved metadata, partial ones are skipped',{timeout:25000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seanime-torrent-test-')),downloads=path.join(directory,'downloads'),seed=new WebTorrent({dht:false,tracker:false,utp:false});
 const make=async(name,byte)=>{const dir=path.join(directory,'src',name);fs.mkdirSync(dir,{recursive:true});const content=Buffer.alloc(300*1024,byte);fs.writeFileSync(path.join(dir,name+'.mp4'),content);fs.writeFileSync(path.join(dir,'info.txt'),'release notes');
  const t=await new Promise((resolve,reject)=>{seed.once('error',reject);seed.seed(dir,{announce:[]},resolve)});fs.mkdirSync(path.join(downloads,'metadata'),{recursive:true});fs.writeFileSync(path.join(downloads,'metadata',t.infoHash+'.torrent'),t.torrentFile);
  fs.cpSync(dir,path.join(downloads,name),{recursive:true});return {hash:t.infoHash,file:path.join(downloads,name,name+'.mp4'),content}};
 const engine=createEngine({directory:downloads,minLooseSize:100*1024,client:new WebTorrent({dht:false,tracker:false,utp:false})});
 try{
  const done=await make('Interstellar (2014) [1080p]',7),partial=await make('Inception (2010) [1080p]',9);
  // Copied in by hand with no metadata: the whole one is offered, the sparse (unfinished) one is not
  fs.mkdirSync(path.join(downloads,'Arrival (2016)'));fs.writeFileSync(path.join(downloads,'Arrival (2016)','Arrival.2016.mp4'),Buffer.alloc(300*1024,3));
  fs.mkdirSync(path.join(downloads,'Dune (2021)'));fs.closeSync(fs.openSync(path.join(downloads,'Dune (2021)','Dune.2021.mp4'),'w'));fs.truncateSync(path.join(downloads,'Dune (2021)','Dune.2021.mp4'),300*1024);
  const broken=Buffer.from(partial.content);broken.fill(0,100*1024,140*1024);fs.writeFileSync(partial.file,broken);
  engine.server.listen(0,'127.0.0.1');await once(engine.server,'listening');const base='http://127.0.0.1:'+engine.server.address().port;
  const post=body=>fetch(base+'/torrents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const found=await (await fetch(base+'/library-scan')).json();assert.deepEqual(found.map(x=>x.release),['Interstellar (2014) [1080p]','Arrival (2016)']);assert.equal(found[0].hash,done.hash);
  assert.equal((await post({action:'library-add',hash:found[1].hash,media:{imdb:'tt2543164',title:'Arrival',year:'2016'}})).status,200);
  assert.equal((await post({action:'library-add',hash:partial.hash,media:{imdb:'tt1375666',title:'Inception'}})).status,400);
  assert.equal((await post({action:'library-add',hash:done.hash,media:{imdb:'tt0816692',title:'Interstellar',year:'2014'}})).status,200);
  const list=await (await fetch(base+'/library')).json();assert.deepEqual(list.map(x=>x.imdb),['tt0816692','tt2543164']);
  const r=await fetch(base+list[0].url);assert.deepEqual(Buffer.from(await r.arrayBuffer()),done.content);
  assert.equal((await (await fetch(base+'/library-scan')).json()).length,0);
 }finally{await engine.close();await new Promise(resolve=>seed.destroy(resolve));fs.rmSync(directory,{recursive:true,force:true})}
});
test('movies move to the chosen library folder and other clients\' downloads join the library',{timeout:25000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seanime-torrent-test-')),downloads=path.join(directory,'downloads'),movies=path.join(directory,'Movies');
 fs.mkdirSync(path.join(downloads,'Toy Story (1995)'),{recursive:true});const toy=Buffer.alloc(200*1024,5);fs.writeFileSync(path.join(downloads,'Toy Story (1995)','Toy.Story.1995.mp4'),toy);
 fs.writeFileSync(path.join(downloads,'library.json'),JSON.stringify([{hash:'b'.repeat(40),imdb:'tt0114709',title:'Toy Story',release:'Toy Story (1995)',file:'Toy Story (1995)/Toy.Story.1995.mp4',size:toy.length,added:1}]));
 const engine=createEngine({directory:downloads,client:new WebTorrent({dht:false,tracker:false,utp:false})});
 try{
  engine.server.listen(0,'127.0.0.1');await once(engine.server,'listening');const base='http://127.0.0.1:'+engine.server.address().port;
  const post=body=>fetch(base+'/torrents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const settings=async()=>(await fetch(base+'/settings')).json();
  assert.equal((await post({action:'set-library-dir',dir:'relative/folder'})).status,400);
  assert.equal((await (await post({action:'set-library-dir',dir:movies})).json()).outside,1);assert.equal((await settings()).libraryDir,movies);
  await post({action:'move-library'});for(let i=0;i<50&&!(await settings()).moving?.done;i++)await new Promise(r=>setTimeout(r,50));
  assert.deepEqual((await settings()).moving,{total:1,moved:1,done:true,error:''});assert.ok(!fs.existsSync(path.join(downloads,'Toy Story (1995)')));
  const list=await (await fetch(base+'/library')).json();assert.equal(list.length,1);assert.deepEqual(Buffer.from(await (await fetch(base+list[0].url)).arrayBuffer()),toy);
  // A qBittorrent download is linked once it is complete and inside the library folder
  const hash='c'.repeat(40);assert.equal((await (await post({action:'external-add',hash,media:{imdb:'tt2543164',title:'Arrival',year:'2016'},release:'Arrival (2016) [1080p]'})).json()).dir,movies);
  fs.mkdirSync(path.join(movies,'Arrival (2016)'));fs.writeFileSync(path.join(movies,'Arrival (2016)','Arrival.2016.mp4'),Buffer.alloc(300*1024,3));fs.writeFileSync(path.join(movies,'Arrival (2016)','Arrival.sample.mp4'),Buffer.alloc(400*1024,1));
  assert.equal((await post({action:'external-done',hash,path:os.tmpdir()})).status,400);
  assert.equal((await post({action:'external-done',hash,path:path.join(movies,'Arrival (2016)')})).status,200);
  const after=await (await fetch(base+'/library')).json();assert.deepEqual(after.map(x=>x.imdb),['tt2543164','tt0114709']);assert.equal(after[0].path,path.join(movies,'Arrival (2016)','Arrival.2016.mp4'));
  assert.deepEqual((await settings()).external,[]);assert.equal((await (await fetch(base+'/library-scan')).json()).length,0);
 }finally{await engine.close();fs.rmSync(directory,{recursive:true,force:true})}
});
test('after a restart only unfinished downloads resume, streams and saved movies are not fetched again',{timeout:25000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seanime-torrent-test-')),h=c=>c.repeat(40),magnet=c=>'magnet:?xt=urn:btih:'+h(c)+'&dn=Movie';
 fs.writeFileSync(path.join(directory,'jobs.json'),JSON.stringify([{magnet:magnet('a'),mode:'stream',title:'Streamed'},{magnet:magnet('b'),mode:'download',title:'Saved'},{magnet:magnet('c'),mode:'download',title:'Unfinished'}]));
 fs.writeFileSync(path.join(directory,'library.json'),JSON.stringify([{hash:h('b'),imdb:'tt0114709',title:'Toy Story',file:'Toy Story/movie.mp4',size:1}]));
 const engine=createEngine({directory,client:new WebTorrent({dht:false,tracker:false,utp:false})});
 try{await engine.restore();assert.deepEqual(engine.snapshot().map(t=>t.hash),[h('c')])}
 finally{await engine.close();fs.rmSync(directory,{recursive:true,force:true})}
});
test('a stream stops by itself once the player stops reading, while it is being read it keeps going',{timeout:25000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seanime-torrent-test-')),source=path.join(directory,'movie.mp4'),content=Buffer.alloc(24*1024*1024,5);fs.writeFileSync(source,content);
 const seed=new WebTorrent({dht:false,tracker:false,utp:false}),client=new WebTorrent({dht:false,tracker:false,utp:false});const engine=createEngine({directory:path.join(directory,'downloads'),client,streamIdleMs:400});
 try{
  const torrent=await new Promise((resolve,reject)=>{seed.once('error',reject);seed.seed(source,{announce:[]},resolve)});
  engine.server.listen(0,'127.0.0.1');await once(engine.server,'listening');const base='http://127.0.0.1:'+engine.server.address().port;
  const hash=await engine.add({magnet:torrent.magnetURI,title:'Test movie',mode:'stream'});const receiving=client.torrents[0];receiving.addPeer('127.0.0.1:'+seed.torrentPort);if(!receiving.ready)await once(receiving,'ready');
  // An open connection (a paused player) keeps the stream alive past the idle time
  const open=await fetch(base+'/media-file/'+hash+'/0');const reader=open.body.getReader();await reader.read();
  await new Promise(r=>setTimeout(r,800));assert.equal(engine.snapshot().length,1);
  await reader.cancel();
  for(let i=0;i<40&&engine.snapshot().length;i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(engine.snapshot().length,0);assert.equal(client.torrents.length,0);
  // Pressing play again starts the stream again
  const again=await fetch(base+'/media-file/'+hash+'/0',{headers:{Range:'bytes=0-255'}});assert.equal(again.status,206);assert.equal(engine.snapshot().length,1);await again.arrayBuffer();
 }finally{await engine.close();if(!seed.destroyed)await new Promise(resolve=>seed.destroy(resolve));fs.rmSync(directory,{recursive:true,force:true})}
});

test('hidden movies are kept after a restart until shown again',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seanime-torrent-test-'));
 const start=async()=>{const engine=createEngine({directory,client:new WebTorrent({dht:false,tracker:false,utp:false})});engine.server.listen(0,'127.0.0.1');await once(engine.server,'listening');return {engine,base:'http://127.0.0.1:'+engine.server.address().port}};
 const post=(base,body)=>fetch(base+'/torrents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let {engine,base}=await start();
 try{
  assert.equal((await post(base,{action:'hide',item:{id:'tt0133093',name:'The Matrix',poster:'https://example.com/p.jpg',year:'1999'}})).status,200);
  assert.equal((await post(base,{action:'hide',item:{id:'../etc'}})).status,400);
  await engine.close();({engine,base}=await start());
  let hidden=(await (await fetch(base+'/settings')).json()).hidden;assert.deepEqual(hidden.map(x=>[x.id,x.name,x.year]),[['tt0133093','The Matrix','1999']]);
  hidden=(await (await post(base,{action:'unhide',id:'tt0133093'})).json()).hidden;assert.equal(hidden.length,0);
 }finally{await engine.close();fs.rmSync(directory,{recursive:true,force:true})}
});
test('series episodes are listed from <library>/Series/<name>, parsed and served without leaving that folder',async()=>{
 assert.equal(seriesFolder('../We/Best: Choi?'),'We Best Choi');assert.equal(seriesFolder('...'),null);
 assert.deepEqual(episodeOf('Show.S02E05.1080p.mkv'),{season:2,episode:5});assert.deepEqual(episodeOf('Drama E07 720p.mp4'),{season:null,episode:7});assert.deepEqual(episodeOf('Show.Episode.12.mp4'),{season:null,episode:12});
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seanime-series-test-')),client=new WebTorrent({dht:false,tracker:false,utp:false}),engine=createEngine({directory,client});
 try{
  const dir=path.join(directory,'Series','My Show','Season 1');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'My.Show.S01E03.mkv'),Buffer.alloc(4096,7));fs.writeFileSync(path.join(directory,'secret.mp4'),'x');
  engine.server.listen(0,'127.0.0.1');await once(engine.server,'listening');const base='http://127.0.0.1:'+engine.server.address().port;
  const list=await(await fetch(base+'/series-files?folder=My%20Show')).json();assert.equal(list.length,1);assert.equal(list[0].episode,3);assert.equal(list[0].season,1);assert.ok(!('path' in list[0]));
  const r=await fetch(base+list[0].url,{headers:{Range:'bytes=0-9'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,10);
  assert.equal((await fetch(base+'/series-file?folder=My%20Show&root=0&file=../../secret.mp4')).status,404);
 }finally{await engine.close();fs.rmSync(directory,{recursive:true,force:true})}
});
test('series episodes past the transfer limit wait and start when a transfer stops',{timeout:20000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seanime-queue-test-')),client=new WebTorrent({dht:false,tracker:false,utp:false,lsd:false}),engine=createEngine({directory,client});
 try{
  await engine.restore();const hashes=[];
  for(let i=0;i<12;i++){const h=(i.toString(16).padStart(2,'0')).repeat(20);hashes.push(await engine.add({magnet:'magnet:?xt=urn:btih:'+h,title:'Ep '+i,mode:'download',folder:'Queue Show'}))}
  let snap=engine.snapshot();assert.equal(snap.filter(t=>!t.queued).length,10);assert.deepEqual(snap.filter(t=>t.queued).map(t=>t.hash),hashes.slice(10));
  assert.ok(fs.existsSync(path.join(directory,'Series','Queue Show')));
  engine.server.listen(0,'127.0.0.1');await once(engine.server,'listening');const base='http://127.0.0.1:'+engine.server.address().port;
  const post=body=>fetch(base+'/torrents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({action:'stop',hash:hashes[11]})).status,200);assert.equal((await post({action:'stop',hash:hashes[0]})).status,200);
  for(let i=0;i<50&&engine.snapshot().some(t=>t.hash===hashes[10]&&t.queued);i++)await new Promise(r=>setTimeout(r,50));
  snap=engine.snapshot();assert.equal(snap.length,10);assert.ok(snap.some(t=>t.hash===hashes[10]&&!t.queued&&t.folder==='Queue Show'));
 }finally{await engine.close();fs.rmSync(directory,{recursive:true,force:true})}
});
