/* Integrated, loopback-only movie/anime torrent playback. GPL-3.0. */
import WebTorrent from 'webtorrent';
import parseTorrent,{toTorrentFile} from 'parse-torrent';
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
export function parseRange(value,length){
 if(!value)return {start:0,end:length-1,status:200};
 const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||(!m[1]&&!m[2]))return null;
 let start=m[1]?Number(m[1]):Math.max(0,length-Number(m[2])),end=m[1]?(m[2]?Math.min(Number(m[2]),length-1):length-1):length-1;
 return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<=end&&start<length?{start,end,status:206}:null;
}
export function cleanMagnet(raw){
 const u=new URL(raw),xt=u.searchParams.get('xt')||'';if(u.protocol!=='magnet:'||!/^urn:btih:(?:[a-fA-F0-9]{40}|[A-Z2-7]{32})$/i.test(xt))throw Error('Invalid torrent magnet');
 const m=new URL('magnet:?');m.searchParams.set('xt',xt);m.searchParams.set('dn',(u.searchParams.get('dn')||'Media').slice(0,180));
 for(const t of ['udp://tracker.opentrackr.org:1337/announce','udp://open.stealth.si:80/announce','https://tracker.opentrackr.org:443/announce'])m.searchParams.append('tr',t);return m.href.replace('xt=urn%3Abtih%3A','xt=urn:btih:');
}
const mimeFor=name=>({'.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mkv':'video/x-matroska','.srt':'text/plain','.vtt':'text/vtt'})[path.extname(name).toLowerCase()]||'application/octet-stream';
const https_=v=>typeof v==='string'&&/^https:\/\//.test(v)?v.slice(0,500):undefined;
export function cleanMedia(m){return m&&/^tt\d{5,10}$/.test(m.imdb)?{imdb:m.imdb,title:String(m.title||'').slice(0,180),year:String(m.year||'').slice(0,4),poster:https_(m.poster),background:https_(m.background)}:undefined}
export function allowedOrigin(origin){if(!origin||origin==='app://-')return true;try{const u=new URL(origin);return ['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)}catch{return false}}
export function createEngine(options={}){
 const directory=options.directory||path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'seanime','media-hub','torrents');fs.mkdirSync(directory,{recursive:true});
 const client=options.client||new WebTorrent({maxConns:40,utp:false});const jobs=new Map();client.on('error',()=>{});
 const metadataDir=path.join(directory,'metadata');fs.mkdirSync(metadataDir,{recursive:true});
 const savedFile=path.join(directory,'jobs.json');let saved=[];try{saved=JSON.parse(fs.readFileSync(savedFile,'utf8'))}catch{}
 function snapshot(){for(const j of jobs.values())record(j);return [...jobs.values()].map(({torrent:t,mode,title,error,media})=>({hash:t.infoHash,title:title||t.name||'Resolving metadata…',mode,error,media,ready:t.ready,progress:t.progress||0,downloaded:t.downloaded||0,length:t.length||0,downloadSpeed:t.downloadSpeed||0,peers:t.numPeers||0,files:t.files?.map((f,i)=>({index:i,name:f.name,length:f.length,playable:/\.(mp4|m4v|webm|mkv|mov)$/i.test(f.name),url:'/media-file/'+t.infoHash+'/'+i}))||[]}))}
 function persist(){fs.writeFileSync(savedFile+'.tmp',JSON.stringify([...jobs.values()].map(j=>({magnet:j.torrent.magnetURI,mode:j.mode,title:j.title,media:j.media,dir:j.torrent.path}))));fs.renameSync(savedFile+'.tmp',savedFile)}
 // Finished movie downloads are kept in library.json, they stay playable from disk after the transfer is stopped.
 const libraryFile=path.join(directory,'library.json');let library=[];try{library=JSON.parse(fs.readFileSync(libraryFile,'utf8'))}catch{}
 function saveLibrary(){fs.writeFileSync(libraryFile+'.tmp',JSON.stringify(library));fs.renameSync(libraryFile+'.tmp',libraryFile)}
 // Downloads go to the movie library folder picked in Settings (streams stay in the app folder). Folders used before
 // stay allowed, so movies left there keep playing.
 const settingsFile=path.join(directory,'settings.json');let settings={};try{settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'))||{}}catch{}
 function saveSettings(){fs.writeFileSync(settingsFile+'.tmp',JSON.stringify(settings));fs.renameSync(settingsFile+'.tmp',settingsFile)}
 const libraryDir=()=>typeof settings.libraryDir==='string'&&path.isAbsolute(settings.libraryDir)?path.resolve(settings.libraryDir):directory;
 const inside=(p,root)=>p.startsWith(path.resolve(root)+path.sep);
 const roots=()=>[...new Set([directory,libraryDir(),...(settings.previous||[]).filter(d=>typeof d==='string'&&path.isAbsolute(d))].map(d=>path.resolve(d)))];
 const libraryPath=x=>{const p=x.path?path.resolve(x.path):path.resolve(directory,x.file);return roots().some(r=>inside(p,r))?p:null};
 const isVideo=name=>/\.(mp4|m4v|webm|mkv|mov)$/i.test(name);
 // Movies sent to another torrent client (qBittorrent, Transmission) wait here until that client finishes them
 const externalFile=path.join(directory,'external.json');let external=[];try{external=JSON.parse(fs.readFileSync(externalFile,'utf8'))}catch{}
 function saveExternal(){fs.writeFileSync(externalFile+'.tmp',JSON.stringify(external));fs.renameSync(externalFile+'.tmp',externalFile)}
 // A video counts as finished only when no part of it is missing on disk
 const allocated=st=>st.blocks===undefined||st.blocks*512>=st.size;
 function largestVideo(p){
  const st=fs.statSync(p);if(st.isFile())return isVideo(p)?p:null;
  const all=[],walk=(dir,depth)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory()){if(depth<2)walk(f,depth+1)}else if(e.isFile()&&isVideo(e.name)&&!/\bsample\b/i.test(e.name))all.push([f,fs.statSync(f).size])}};
  walk(p,0);return all.sort((a,b)=>b[1]-a[1])[0]?.[0]??null}
 let moving=null;
 async function moveItem(from,to){try{await fs.promises.rename(from,to)}catch(e){if(e.code!=='EXDEV')throw e;await fs.promises.cp(from,to,{recursive:true,errorOnExist:true,force:false});await fs.promises.rm(from,{recursive:true,force:true})}}
 // Moves saved movies (their whole release folder) into the current library folder
 // A finished download that is still seeding is moved too, its transfer is stopped first (the files are kept)
 const busy=h=>{const j=jobs.get(h);return !!j&&!(j.mode==='download'&&j.torrent.progress>=1)};
 const outside=()=>library.filter(x=>{const p=libraryPath(x);return p&&!inside(p,libraryDir())&&!busy(x.hash)});
 function moveLibrary(){
  if(moving&&!moving.done)return;const target=libraryDir(),items=outside();moving={total:items.length,moved:0,done:false,error:''};
  (async()=>{fs.mkdirSync(target,{recursive:true});for(const x of items){try{
   if(jobs.has(x.hash)){await client.remove(x.hash);jobs.delete(x.hash);persist()}
   const p=libraryPath(x),root=roots().find(r=>inside(p,r)&&r!==target)||roots().find(r=>inside(p,r)),top=path.relative(root,p).split(path.sep)[0],from=path.join(root,top),to=path.join(target,top),moved=path.join(to,path.relative(from,p));
   if(fs.existsSync(from)){if(fs.existsSync(to))throw Error(`"${top}" is already in the new folder`);await moveItem(from,to)}else if(!fs.existsSync(moved))throw Error(`"${x.title}" was not found`);
   x.path=moved;delete x.file;saveLibrary();moving.moved++;
  }catch(e){moving.error=e.message||'Could not move a movie'}}moving.done=true})();
 }
 function record(job){
  const t=job.torrent;if(job.mode!=='download'||!job.media||!t.ready||t.progress<1||library.some(x=>x.hash===t.infoHash))return;
  const f=t.files.filter(f=>/\.(mp4|m4v|webm|mkv|mov)$/i.test(f.name)).sort((a,b)=>b.length-a.length)[0];if(!f)return;
  library.unshift({hash:t.infoHash,...job.media,release:job.title,path:path.join(t.path,f.path),size:f.length,added:Date.now()});try{saveLibrary()}catch{}
 }
 // Downloads finished before the library existed (or whose details were lost) are found again from their saved
 // metadata. A file only counts once every piece of it matches the torrent's hashes, so partial streams are skipped.
 const verified=new Map();let scanning;
 async function complete(meta,file,root){
  let size;try{const st=fs.statSync(path.join(root,file.path));size=st.size;if(st.blocks!==undefined&&st.blocks*512<size*0.9)return false}catch{return false}if(size!==file.length)return false;
  const first=Math.floor(file.offset/meta.pieceLength),last=Math.floor((file.offset+file.length-1)/meta.pieceLength),all=[];for(let i=first;i<=last;i++)all.push(i);
  // Spread samples first so incomplete files fail without reading all of them
  const step=Math.max(1,Math.floor(all.length/24)),order=[...all.filter((_,i)=>i%step===0),...all.filter((_,i)=>i%step!==0)];
  const handles=new Map();try{
   for(const i of order){
    const start=i*meta.pieceLength,end=Math.min(start+meta.pieceLength,meta.length),buf=Buffer.alloc(end-start);
    for(const f of meta.files){const a=Math.max(start,f.offset),b=Math.min(end,f.offset+f.length);if(a>=b)continue;
     if(!handles.has(f.path))handles.set(f.path,await fs.promises.open(path.join(root,f.path),'r'));const {bytesRead}=await handles.get(f.path).read(buf,a-start,b-a,a-f.offset);if(bytesRead!==b-a)return false}
    if(crypto.createHash('sha1').update(buf).digest('hex')!==meta.pieces[i])return false;
   }return true;
  }catch{return false}finally{for(const h of handles.values())await h.close().catch(()=>{})}
 }
 // Videos with no saved metadata cannot be hash checked, they are only offered when no part of the file is missing on disk
 const minLooseSize=options.minLooseSize??50*2**20;
 function looseVideos(root,covered){
  const found=[],walk=(dir,depth)=>{for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const rel=path.join(dir,e.name),abs=path.join(root,rel);
   if(e.isDirectory()){if(depth<2&&!(dir===''&&e.name==='metadata'&&root===path.resolve(directory)))walk(rel,depth+1);continue}
   if(!e.isFile()||!isVideo(e.name)||/\bsample\b/i.test(e.name)||covered.has(abs))continue;
   const st=fs.statSync(abs);if(st.size<minLooseSize||st.blocks===undefined||st.blocks*512<st.size)continue;
   found.push({hash:crypto.createHash('sha1').update('file:'+abs).digest('hex'),release:path.basename(dir)||e.name.replace(/\.[^.]+$/,''),path:abs,size:st.size,mtime:st.mtimeMs})}};
  try{walk('',0)}catch{}return found}
 function scan(){return scanning??=(async()=>{
  const found=[],covered=new Set([...library.map(libraryPath).filter(Boolean),...[...jobs.values()].flatMap(j=>j.torrent.files?.map(f=>path.resolve(j.torrent.path,f.path))??[]),...external.map(x=>x.path).filter(Boolean)]);
  for(const name of fs.readdirSync(metadataDir).filter(n=>/^[a-f0-9]{40}\.torrent$/.test(n))){
   const hash=name.slice(0,40);
   try{const meta=await parseTorrent(fs.readFileSync(path.join(metadataDir,name)));if(meta.infoHash!==hash)continue;for(const r of roots())for(const f of meta.files)covered.add(path.resolve(r,f.path));
    if(library.some(x=>x.hash===hash)||jobs.has(hash))continue;
    const file=meta.files.filter(f=>isVideo(f.name)).sort((a,b)=>b.length-a.length)[0],root=file&&roots().find(r=>fs.existsSync(path.join(r,file.path)));if(!root)continue;
    const abs=path.resolve(root,file.path);if(!roots().some(r=>inside(abs,r)))continue;
    const mtime=fs.statSync(abs).mtimeMs,known=verified.get(hash);
    if(!(known&&known.mtime===mtime&&known.path===abs)){if(!await complete(meta,file,root))continue;verified.set(hash,{release:meta.name,path:abs,size:file.length,mtime})}
    found.push({hash,release:meta.name,size:file.length});
   }catch{}
  }
  for(const v of roots().flatMap(r=>looseVideos(r,covered)))if(!library.some(x=>x.hash===v.hash)){verified.set(v.hash,v);found.push({hash:v.hash,release:v.release,size:v.size})}
  return found;
 })().finally(()=>{scanning=undefined})}
 // Finished movie downloads do not seed: the transfer is stopped and the files stay on disk
 async function stopFinished(hash){const j=jobs.get(hash);if(!j||j.mode!=='download'||j.torrent.progress<1)return;jobs.delete(hash);persist();try{await client.remove(hash)}catch{}}
 async function add(value){
  let metadata;const media=cleanMedia(value.media);
  if(value.torrentUrl){
   const u=new URL(value.torrentUrl);if(u.origin!=='http://127.0.0.1:11438'||!/^\/source\/[a-f0-9-]{36}\/stream\.torrent$/.test(u.pathname))throw Error('Unsupported torrent metadata source');
   const response=await fetch(u,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Torrent metadata unavailable');let bytes=0,parts=[];for await(const b of response.body){bytes+=b.length;if(bytes>4*1024*1024)throw Error('Torrent metadata too large');parts.push(Buffer.from(b))}metadata=Buffer.concat(parts);
  }
  const parsed=await parseTorrent(metadata||cleanMagnet(value.magnet));
  const magnet=cleanMagnet('magnet:?xt=urn:btih:'+parsed.infoHash+'&dn='+encodeURIComponent(value.title||parsed.name||'Media')),found=await client.get(magnet);if(found){const j=jobs.get(found.infoHash);if(j&&media)j.media=media;if(value.mode==='download'&&j){j.mode='download';const select=()=>found.select(0,found.pieces.length-1,0);if(found.ready)select();else found.once('ready',select);persist()}return found.infoHash}
  if(jobs.size>=10)throw Error('Stop an existing transfer before adding another');
  const stored=path.join(metadataDir,parsed.infoHash+'.torrent');if(!metadata&&fs.existsSync(stored))metadata=fs.readFileSync(stored);
  if(metadata){const p=await parseTorrent(metadata);if(p.infoHash!==parsed.infoHash)throw Error('Cached metadata does not match this torrent');p.urlList=[];p.announce=['udp://tracker.opentrackr.org:1337/announce','udp://open.stealth.si:80/announce'];metadata=toTorrentFile(p)}
  const dir=typeof value.dir==='string'&&roots().includes(path.resolve(value.dir))?path.resolve(value.dir):value.mode==='download'?libraryDir():directory;fs.mkdirSync(dir,{recursive:true});
  const t=client.add(metadata||magnet,{path:dir,deselect:value.mode!=='download'});const job={torrent:t,mode:value.mode==='download'?'download':'stream',title:String(value.title||'').slice(0,180),media,error:'',used:Date.now()};t.on('error',()=>{});if(!t.infoHash)await new Promise((resolve,reject)=>{t.once('infoHash',resolve);t.once('error',reject)});jobs.set(t.infoHash,job);
  t.on('error',()=>{job.error='Torrent connection failed'});t.on('done',()=>{record(job);if(job.mode==='download')setImmediate(()=>stopFinished(t.infoHash))});t.once('ready',()=>{try{fs.writeFileSync(path.join(metadataDir,t.infoHash+'.torrent'),t.torrentFile)}catch{}if(job.mode==='stream')for(const f of t.files)f.deselect();persist()});persist();return t.infoHash;
 }
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1'),origin=req.headers.origin;
  if(!allowedOrigin(origin)){res.writeHead(403);res.end();return}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
  function json(status,value){const b=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(b),'Cache-Control':'no-store'});res.end(b)}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});res.end();return}
  if(req.method==='GET'&&u.pathname==='/health')return json(200,{ok:true,revision:'media-engine-v2'});
  if(req.method==='GET'&&u.pathname==='/torrents')return json(200,snapshot());
  if(req.method==='GET'&&u.pathname==='/settings')return json(200,{libraryDir:libraryDir(),defaultDir:directory,custom:libraryDir()!==path.resolve(directory),outside:outside().length,moving,external:external.map(x=>x.hash)});
  if(req.method==='GET'&&u.pathname==='/library-scan')return json(200,await scan());
  if(req.method==='GET'&&u.pathname==='/library')return json(200,library.filter(x=>{const p=libraryPath(x);return p&&fs.existsSync(p)}).map(x=>({...x,file:x.file||path.basename(x.path),url:'/library-file/'+x.hash})));
  const saved_=/^\/library-file\/([a-f0-9]{40})$/.exec(u.pathname);
  if(saved_&&(req.method==='GET'||req.method==='HEAD')){
   const x=library.find(x=>x.hash===saved_[1]),p=x&&libraryPath(x);let size;try{size=fs.statSync(p).size}catch{return json(404,{error:'File not found'})}
   const range=parseRange(req.headers.range,size);if(!range){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return}
   const headers={'Content-Type':mimeFor(p),'Content-Length':range.end-range.start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store'};if(range.status===206)headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;
   res.writeHead(range.status,headers);if(req.method==='HEAD'){res.end();return}
   const stream=fs.createReadStream(p,{start:range.start,end:range.end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
  }
  if(req.method==='POST'&&u.pathname==='/torrents'){
   if(!req.headers['content-type']?.startsWith('application/json'))return json(400,{error:'JSON required'});
   try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384)throw Error('Request too large')};const v=JSON.parse(raw);
    if(v.action==='resume'){if(!/^[a-f0-9]{40}$/.test(v.hash)||!fs.existsSync(path.join(metadataDir,v.hash+'.torrent')))throw Error('Saved transfer unavailable');const hash=await add({magnet:'magnet:?xt=urn:btih:'+v.hash,title:v.title||'Saved media',mode:v.mode==='download'?'download':'stream',media:v.media});return json(200,{hash})}
    if(v.action==='library-add'){const x=verified.get(v.hash),media=cleanMedia(v.media);if(!x||!media)throw Error('Unknown download');if(!library.some(y=>y.hash===v.hash)){library.unshift({hash:v.hash,...media,release:x.release,path:x.path,size:x.size,added:Date.now()});saveLibrary()}return json(200,{ok:true})}
    if(v.action==='set-library-dir'){
     const dir=typeof v.dir==='string'&&v.dir.trim()?path.resolve(v.dir.trim()):'';if(v.dir&&!path.isAbsolute(String(v.dir).trim()))throw Error('Choose a full folder path');
     if(moving&&!moving.done)throw Error('Wait for the movies being moved');if(dir)fs.mkdirSync(dir,{recursive:true});
     const old=libraryDir();settings={...settings,libraryDir:dir||undefined,previous:[...new Set([...(settings.previous||[]),old])].filter(d=>d!==path.resolve(directory)&&d!==(dir||path.resolve(directory)))};saveSettings();
     return json(200,{ok:true,libraryDir:libraryDir(),outside:outside().length})}
    if(v.action==='move-library'){moveLibrary();return json(200,{ok:true,moving})}
    if(v.action==='external-add'){const media=cleanMedia(v.media);if(!/^[a-f0-9]{40}$/.test(v.hash)||!media)throw Error('Invalid movie');external=[{hash:v.hash,media,release:String(v.release||media.title).slice(0,180),added:Date.now()},...external.filter(x=>x.hash!==v.hash)].slice(0,100);saveExternal();return json(200,{ok:true,dir:libraryDir()})}
    if(v.action==='external-done'){
     const x=external.find(x=>x.hash===v.hash);if(!x)throw Error('Unknown download');const p=typeof v.path==='string'&&path.isAbsolute(v.path)?path.resolve(v.path):'';
     if(!p||!roots().some(r=>inside(p,r)))throw Error('The download is outside the movie library folder');
     const file=largestVideo(p);if(!file||!roots().some(r=>inside(file,r)))throw Error('No video found in the download');const st=fs.statSync(file);if(!allocated(st))throw Error('The download is not finished');
     if(!library.some(y=>y.hash===x.hash))library.unshift({hash:x.hash,...x.media,release:x.release,path:file,size:st.size,added:Date.now()});saveLibrary();external=external.filter(y=>y.hash!==x.hash);saveExternal();return json(200,{ok:true})}
    // Movies removed from the torrent client are forgotten, so they can be sent again (new ones get a minute to show up)
    if(v.action==='external-sync'){const present=new Set(Array.isArray(v.present)?v.present.map(h=>String(h).toLowerCase()):[]);const before=external.length;external=external.filter(x=>present.has(x.hash)||Date.now()-(x.added||0)<60000);if(external.length!==before)saveExternal();return json(200,{ok:true})}
    if(v.action==='external-remove'){external=external.filter(x=>x.hash!==v.hash);saveExternal();return json(200,{ok:true})}
    if(v.action==='library-remove'){library=library.filter(x=>x.hash!==v.hash);saveLibrary();return json(200,{ok:true})}
    if(v.action==='restore'){await restore();return json(200,{ok:true})}
    if(v.action==='stop'){
     const job=jobs.get(v.hash);if(!job)throw Error('Unknown transfer');await client.remove(v.hash);jobs.delete(v.hash);persist();return json(200,{ok:true});
    }
    const hash=await add(v);return json(200,{hash});
   }catch(e){return json(400,{error:e.message||'Could not add torrent'})}
  }
  const match=/^\/media-file\/([a-f0-9]{40})\/(\d+)$/.exec(u.pathname);
  if(match&&(req.method==='GET'||req.method==='HEAD')){
   const job=jobs.get(match[1]),t=job?.torrent,file=t?.files?.[Number(match[2])];if(!file||!t.ready)return json(404,{error:'Torrent metadata is not ready'});
   const range=parseRange(req.headers.range,file.length);if(!range){res.writeHead(416,{'Content-Range':'bytes */'+file.length});res.end();return}
   const headers={'Content-Type':mimeFor(file.name),'Content-Length':range.end-range.start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store'};if(range.status===206)headers['Content-Range']=`bytes ${range.start}-${range.end}/${file.length}`;
   res.writeHead(range.status,headers);if(req.method==='HEAD'){res.end();return}
   job.open=(job.open||0)+1;job.played=true;job.used=Date.now();
   const stream=file.createReadStream({start:range.start,end:range.end});stream.on('error',()=>res.destroy());res.on('close',()=>{stream.destroy();job.open--;job.used=Date.now()});stream.pipe(res);return;
  }
  json(404,{error:'Unknown endpoint'});
 });
 // Restore transfers only after the user explicitly opens Downloads, avoiding
 // unsolicited network activity or downloads merely from launching Seanime.
 // A stream stops once the player has not read from it for a while (closing the player), so it doesn't keep using
 // the connection. A paused player keeps its connection open. Streams that never started playing get more time.
 const streamIdle=options.streamIdleMs??120000,idleTimer=setInterval(()=>{for(const [hash,j] of jobs)if(j.mode==='stream'&&!j.open&&Date.now()-j.used>(j.played?streamIdle:streamIdle*5)){jobs.delete(hash);persist();Promise.resolve().then(()=>client.remove(hash)).catch(()=>{})}},Math.min(15000,streamIdle/4));idleTimer.unref?.();
 // Only unfinished downloads are resumed after a restart. Streams were for watching at that moment, restarting them
 // would download the movie again in the background, and movies already in the library are never fetched twice.
 const inLibrary=v=>{try{const hash=new URL(v.magnet).searchParams.get('xt').split(':').pop().toLowerCase();return library.some(x=>x.hash===hash)}catch{return false}};
 let restored=false;const restore=async()=>{if(restored)return;restored=true;for(const v of saved.filter(v=>v.mode==='download'&&!inLibrary(v)).slice(0,10))try{await add(v)}catch{}};
 return {server,client,add,snapshot,restore,close:()=>new Promise(resolve=>{clearInterval(idleTimer);server.close(()=>client.destroy(resolve))})};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const e=createEngine();e.server.listen(Number(process.env.SEANIME_MEDIA_PORT||11437),'127.0.0.1',()=>console.log('Media torrent engine listening on loopback'));
 const shutdown=()=>{e.server.close();e.client.destroy(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref()};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
