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
// Series downloads are kept in <library>/Series/<series name>
export function seriesFolder(name){const n=String(name||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/^\.+|\.+$/g,'').slice(0,120).trim();return n||null}
// Season and episode read from a file name: S01E02, 1x02, "Episode 2", E02
export function episodeOf(name){const n=path.basename(name).replace(/\.[^.]+$/,'');let m=/\bS(\d{1,2})[ ._-]?E(\d{1,4})\b/i.exec(n)||/\b(\d{1,2})x(\d{2,3})\b/.exec(n);if(m)return {season:Number(m[1]),episode:Number(m[2])};
 m=/\b(?:Episode|Ep|E)[ ._-]?(\d{1,4})\b/i.exec(n);if(m)return {season:null,episode:Number(m[1])};return {season:null,episode:null}}
export function allowedOrigin(origin){if(!origin||origin==='app://-')return true;try{const u=new URL(origin);return ['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)}catch{return false}}
export function createEngine(options={}){
 const directory=options.directory||path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'seanime','media-hub','torrents');fs.mkdirSync(directory,{recursive:true});
 const client=options.client||new WebTorrent({maxConns:40,utp:false});const jobs=new Map();client.on('error',()=>{});
 const metaLengths=new Map(); const metadataDir=path.join(directory,'metadata');fs.mkdirSync(metadataDir,{recursive:true});
 const savedFile=path.join(directory,'jobs.json');let saved=[];try{saved=JSON.parse(fs.readFileSync(savedFile,'utf8'))}catch{}
 // Series episodes past the transfer limit wait their turn, they start as other downloads finish
 const waitingFile=path.join(directory,'waiting.json');let waiting=[];try{waiting=JSON.parse(fs.readFileSync(waitingFile,'utf8')).filter(w=>/^[a-f0-9]{40}$/.test(w.hash))}catch{}
 function saveWaiting(){fs.writeFileSync(waitingFile+'.tmp',JSON.stringify(waiting));fs.renameSync(waitingFile+'.tmp',waitingFile)}
 let pumping=false;async function pump(){if(pumping||!restored)return;pumping=true;try{while(jobs.size<10&&waiting.length){const w=waiting.shift();saveWaiting();try{await add(w)}catch{}}}finally{pumping=false}}
 function snapshot(){for(const j of jobs.values())record(j);const queued=waiting.filter(w=>!jobs.has(w.hash)).map(w=>({hash:w.hash,title:w.title,mode:'download',queued:true,folder:w.folder,ready:false,progress:0,downloaded:0,length:0,downloadSpeed:0,peers:0,files:[]}));return [...jobs.values()].map(({torrent:t,mode,title,error,media,folder})=>({hash:t.infoHash,title:title||t.name||'Resolving metadata…',mode,error,media,folder,ready:t.ready,progress:t.progress||0,downloaded:t.downloaded||0,length:t.length||0,downloadSpeed:t.downloadSpeed||0,peers:t.numPeers||0,files:t.files?.map((f,i)=>({index:i,name:f.name,length:f.length,playable:/\.(mp4|m4v|webm|mkv|mov)$/i.test(f.name),url:'/media-file/'+t.infoHash+'/'+i}))||[]})).concat(queued)}
 function persist(){fs.writeFileSync(savedFile+'.tmp',JSON.stringify([...jobs.values()].map(j=>({magnet:j.torrent.magnetURI,mode:j.mode,title:j.title,media:j.media,folder:j.folder,dir:j.torrent.path}))));fs.renameSync(savedFile+'.tmp',savedFile)}
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
 // Subtitles saved beside a video as <video>.<language>.srt, so they play with no internet
 const sidecars=video=>{const base=path.basename(video).replace(/\.[^.]+$/,''),low=base.toLowerCase();let names=[];try{names=fs.readdirSync(path.dirname(video))}catch{}
  return names.filter(n=>/\.(srt|vtt|ass|ssa)$/i.test(n)).map(n=>({name:n,stem:n.replace(/\.[^.]+$/,'')})).filter(x=>x.stem.toLowerCase()===low||x.stem.toLowerCase().startsWith(low+'.')).map(x=>({path:path.join(path.dirname(video),x.name),language:x.stem.slice(base.length+1).split(/[._,]/)[0].toLowerCase()||'und'}))};
 const savedSubs=video=>sidecars(video).filter(x=>/\.(srt|vtt)$/i.test(x.path)).map(x=>({language:x.language,url:'/saved-subtitle?'+new URLSearchParams({path:x.path})}));
 // Subtitle tracks inside an MKV are listed near its start. Only the anime player reads them, movies and series need a saved file
 const embedded=new Map();
 async function hasEmbeddedSubs(video){const st=fs.statSync(video),key=video+':'+st.size;if(embedded.has(key))return embedded.get(key);
  const h=await fs.promises.open(video,'r');try{const n=Math.min(st.size,4*2**20),head=Buffer.alloc(n);await h.read(head,0,n,0);
   const found=/\.mkv$/i.test(video)&&['S_TEXT/','S_HDMV/PGS','S_VOBSUB'].some(x=>head.includes(x));embedded.set(key,found);return found}finally{await h.close()}}
 // A video that found no subtitles is tried again a day later
 const metaDir=path.join(directory,'saved-meta');fs.mkdirSync(metaDir,{recursive:true});
 const triedFile=path.join(directory,'subtitles-tried.json');let tried={};try{tried=JSON.parse(fs.readFileSync(triedFile,'utf8'))}catch{}
 const checkVideo=p=>{if(typeof p!=='string'||!path.isAbsolute(p)||!isVideo(p)||!fs.statSync(p).isFile())throw Error('Unknown video');return path.resolve(p)};
 async function subtitleNeeds(video,readsEmbedded){if(Date.now()-(tried[video]||0)<864e5)return [];const have=sidecars(video).map(x=>x.language);
  if(have.some(l=>l!=='ar'&&l!=='en')||(readsEmbedded&&await hasEmbeddedSubs(video)))return [];return ['ar','en'].filter(l=>!have.includes(l))}
 async function saveSubtitle(video,language,url){
  if(!/^[a-z]{2,3}(-[a-z]{2})?$/.test(language)||!/^https:\/\//.test(url))throw Error('Invalid subtitle');
  const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Subtitle unavailable');const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>5*2**20)throw Error('Subtitle too large');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{text=new TextDecoder(language==='ar'?'windows-1256':'windows-1252').decode(bytes)}
  if(!text.includes('-->'))throw Error('Not a subtitle file');
  const out=video.replace(/\.[^.]+$/,'')+'.'+language+'.srt';fs.writeFileSync(out+'.tmp',text);fs.renameSync(out+'.tmp',out)}
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
 async function stopFinished(hash){const j=jobs.get(hash);if(!j||j.mode!=='download'||(!j.torrent.done&&j.torrent.progress<1))return;jobs.delete(hash);persist();try{await client.remove(hash)}catch{}pump()}
 async function add(value){
  let metadata;const media=cleanMedia(value.media);
  if(value.torrentUrl){
   const u=new URL(value.torrentUrl);if(u.origin!=='http://127.0.0.1:11438'||!/^\/source\/[a-f0-9-]{36}\/stream\.torrent$/.test(u.pathname))throw Error('Unsupported torrent metadata source');
   const response=await fetch(u,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Torrent metadata unavailable');let bytes=0,parts=[];for await(const b of response.body){bytes+=b.length;if(bytes>4*1024*1024)throw Error('Torrent metadata too large');parts.push(Buffer.from(b))}metadata=Buffer.concat(parts);
  }
  const parsed=await parseTorrent(metadata||cleanMagnet(value.magnet));
  const magnet=cleanMagnet('magnet:?xt=urn:btih:'+parsed.infoHash+'&dn='+encodeURIComponent(value.title||parsed.name||'Media')),found=await client.get(magnet);if(found){const j=jobs.get(found.infoHash);if(j&&media)j.media=media;if(value.mode==='download'&&j){j.mode='download';const select=()=>found.select(0,found.pieces.length-1,0);if(found.ready)select();else found.once('ready',select);persist();/* Already complete from streaming: no 'done' comes again */if(found.progress>=1){record(j);setImmediate(()=>stopFinished(found.infoHash))}}return found.infoHash}
  if(jobs.size>=10){
   if(value.mode!=='download'||value.folder===undefined)throw Error('Stop an existing transfer before adding another');
   const folder=seriesFolder(value.folder);if(!folder)throw Error('Invalid series name');
   if(!waiting.some(w=>w.hash===parsed.infoHash)){if(waiting.length>=500)throw Error('Too many episodes are waiting');waiting.push({hash:parsed.infoHash,magnet,mode:'download',title:String(value.title||'').slice(0,180),folder});saveWaiting()}return parsed.infoHash}
  const stored=path.join(metadataDir,parsed.infoHash+'.torrent');if(!metadata&&fs.existsSync(stored))metadata=fs.readFileSync(stored);
  if(metadata){const p=await parseTorrent(metadata);if(p.infoHash!==parsed.infoHash)throw Error('Cached metadata does not match this torrent');p.urlList=[];p.announce=['udp://tracker.opentrackr.org:1337/announce','udp://open.stealth.si:80/announce'];metadata=toTorrentFile(p)}
  const folder=value.mode==='download'&&value.folder!==undefined?seriesFolder(value.folder):undefined;if(value.folder!==undefined&&value.mode==='download'&&!folder)throw Error('Invalid series name');
  const dir=folder?path.join(libraryDir(),'Series',folder):typeof value.dir==='string'&&roots().includes(path.resolve(value.dir))?path.resolve(value.dir):value.mode==='download'?libraryDir():directory;fs.mkdirSync(dir,{recursive:true});
  const t=client.add(metadata||magnet,{path:dir,deselect:value.mode!=='download'});const job={torrent:t,mode:value.mode==='download'?'download':'stream',title:String(value.title||'').slice(0,180),media,folder,error:'',used:Date.now()};t.on('error',()=>{});if(!t.infoHash)await new Promise((resolve,reject)=>{t.once('infoHash',resolve);t.once('error',reject)});jobs.set(t.infoHash,job);
  t.on('error',()=>{job.error='Torrent connection failed'});t.on('done',()=>{record(job);if(job.mode==='download')setImmediate(()=>stopFinished(t.infoHash));/* A stream that has the whole torrent plays from disk and shares nothing */else if(t.progress>=1){t.pause();for(const w of [...t.wires])w.destroy()}});t.once('ready',()=>{try{fs.writeFileSync(path.join(metadataDir,t.infoHash+'.torrent'),t.torrentFile)}catch{}if(job.mode==='stream')for(const f of t.files)f.deselect();persist()});persist();return t.infoHash;
 }
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1'),origin=req.headers.origin;
  if(!allowedOrigin(origin)){res.writeHead(403);res.end();return}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
  function json(status,value){const b=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(b),'Cache-Control':'no-store'});res.end(b)}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});res.end();return}
  if(req.method==='GET'&&u.pathname==='/health')return json(200,{ok:true,revision:'media-engine-v5'});
  if(req.method==='GET'&&u.pathname==='/torrents')return json(200,snapshot());
  // Details of downloaded titles, so their pages still open with no internet
  const savedMeta=/^\/saved-meta(?:\/(tt\d{5,10}))?$/.exec(u.pathname);
  if(savedMeta&&req.method==='GET'){
   if(savedMeta[1]){try{return json(200,JSON.parse(fs.readFileSync(path.join(metaDir,savedMeta[1]+'.json'),'utf8')))}catch{return json(404,{error:'Not saved'})}}
   const all=[];for(const n of fs.readdirSync(metaDir).filter(n=>n.endsWith('.json'))){try{const {id,type,name,poster,background,savedAt}=JSON.parse(fs.readFileSync(path.join(metaDir,n),'utf8'));all.push({id,type,name,poster,background,savedAt})}catch{}}return json(200,all)}
  if(u.pathname==='/saved-meta'&&req.method==='POST'){
   if(!req.headers['content-type']?.startsWith('application/json'))return json(400,{error:'JSON required'});
   try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4*2**20)throw Error('Request too large')};const m=JSON.parse(raw);if(!/^tt\d{5,10}$/.test(m.id)||typeof m.name!=='string')throw Error('Invalid details');
    fs.writeFileSync(path.join(metaDir,m.id+'.json'),JSON.stringify({...m,savedAt:Date.now()}));return json(200,{ok:true})}catch(e){return json(400,{error:e.message})}}
  if(req.method==='GET'&&u.pathname==='/saved-subtitle'){const p=path.resolve(String(u.searchParams.get('path')||''));
   if(!/\.(srt|vtt)$/i.test(p)||!roots().some(r=>inside(p,r)))return json(404,{error:'File not found'});let b;try{b=fs.readFileSync(p)}catch{return json(404,{error:'File not found'})}
   res.writeHead(200,{'Content-Type':mimeFor(p)+'; charset=utf-8','Content-Length':b.length,'Cache-Control':'no-store'});res.end(b);return}
  if(req.method==='GET'&&u.pathname==='/settings')return json(200,{libraryDir:libraryDir(),seriesDir:path.join(libraryDir(),'Series'),defaultDir:directory,custom:libraryDir()!==path.resolve(directory),outside:outside().length,moving,external:external.map(x=>x.hash),hidden:Array.isArray(settings.hidden)?settings.hidden:[]});
  if(req.method==='GET'&&u.pathname==='/library-scan')return json(200,await scan());
  // Episodes saved for a series: torrents and files from the download sites, in every library folder used so far
  // A stopped, unfinished episode stays on disk: it is complete only once its size matches the torrent's
  async function torrentLengths(){
   for(const n of fs.readdirSync(metadataDir).filter(n=>/^[a-f0-9]{40}\.torrent$/.test(n)&&!metaLengths.has(n))){
    try{const meta=await parseTorrent(fs.readFileSync(path.join(metadataDir,n)));metaLengths.set(n,meta.files.map(f=>[f.path,f.length]))}catch{metaLengths.set(n,[])}}
   const out=new Map();for(const files of metaLengths.values())for(const [f,l] of files){const k=path.basename(f);out.set(k,Math.max(out.get(k)||0,l))}return out}
  function seriesFiles(name){
   const folder=seriesFolder(name);if(!folder)return [];const found=[];
   for(const r of roots()){const base=path.join(r,'Series',folder),walk=(dir,depth)=>{let list;try{list=fs.readdirSync(dir,{withFileTypes:true})}catch{return}for(const e of list){const f=path.join(dir,e.name);
    if(e.isDirectory()){if(depth<3)walk(f,depth+1)}else if(e.isFile()&&isVideo(e.name)&&!/\bsample\b/i.test(e.name)){const st=fs.statSync(f),rel=path.relative(base,f);if(found.some(x=>x.path===f))continue;
     found.push({path:f,localPath:f,subs:savedSubs(f),name:e.name,file:rel,size:st.size,complete:allocated(st),...episodeOf(e.name),url:'/series-file?'+new URLSearchParams({folder,root:String(roots().indexOf(r)),file:rel})})}}};walk(base,0)}
   return found}
  if(req.method==='GET'&&u.pathname==='/series-files'){const busy=new Set([...jobs.values()].filter(j=>j.torrent.progress<1).flatMap(j=>j.torrent.files?.map(f=>path.resolve(j.torrent.path,f.path))??[]));
   const lengths=await torrentLengths(),key=p=>path.basename(p);
   return json(200,seriesFiles(u.searchParams.get('folder')).map(({path:p,...x})=>({...x,complete:x.complete&&!busy.has(p)&&(!lengths.has(key(p))||lengths.get(key(p))===x.size)})))}
  // Every series folder with its episodes on disk
  if(req.method==='GET'&&u.pathname==='/series-library'){const busy=new Set([...jobs.values()].filter(j=>j.torrent.progress<1).flatMap(j=>j.torrent.files.map(f=>f.path)));
   const lengths=await torrentLengths(),key=p=>path.basename(p),names=new Set();
   for(const r of roots()){try{for(const e of fs.readdirSync(path.join(r,'Series'),{withFileTypes:true}))if(e.isDirectory())names.add(e.name)}catch{}}
   return json(200,[...names].sort((a,b)=>a.localeCompare(b)).map(folder=>({folder,files:seriesFiles(folder).map(({path:p,...x})=>({...x,complete:x.complete&&!busy.has(p)&&(!lengths.has(key(p))||lengths.get(key(p))===x.size)}))})).filter(x=>x.files.length))}
  if(u.pathname==='/series-file'&&(req.method==='GET'||req.method==='HEAD')){
   const folder=seriesFolder(u.searchParams.get('folder')),r=roots()[Number(u.searchParams.get('root'))],base=folder&&r&&path.join(r,'Series',folder),p=base&&path.resolve(base,String(u.searchParams.get('file')||''));
   let size;try{if(!p||!inside(p,base)||!isVideo(p))throw 0;size=fs.statSync(p).size}catch{return json(404,{error:'File not found'})}
   const range=parseRange(req.headers.range,size);if(!range){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return}
   const headers={'Content-Type':mimeFor(p),'Content-Length':range.end-range.start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store'};if(range.status===206)headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;
   res.writeHead(range.status,headers);if(req.method==='HEAD'){res.end();return}
   const stream=fs.createReadStream(p,{start:range.start,end:range.end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
  }
  if(req.method==='GET'&&u.pathname==='/library')return json(200,library.filter(x=>{const p=libraryPath(x);return p&&fs.existsSync(p)}).map(x=>({...x,localPath:libraryPath(x),subs:savedSubs(libraryPath(x)),file:x.file||path.basename(x.path),url:'/library-file/'+x.hash})));
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
    if(v.action==='subtitle-status')return json(200,{needs:await subtitleNeeds(checkVideo(v.path),v.readsEmbedded===true)});
    if(v.action==='subtitle-save'){await saveSubtitle(checkVideo(v.path),String(v.language),String(v.url));return json(200,{ok:true})}
    if(v.action==='subtitle-tried'){tried[checkVideo(v.path)]=Date.now();fs.writeFileSync(triedFile,JSON.stringify(tried));return json(200,{ok:true})}
    if(v.action==='resume'){if(!/^[a-f0-9]{40}$/.test(v.hash)||!fs.existsSync(path.join(metadataDir,v.hash+'.torrent')))throw Error('Saved transfer unavailable');const hash=await add({magnet:'magnet:?xt=urn:btih:'+v.hash,title:v.title||'Saved media',mode:v.mode==='download'?'download':'stream',media:v.media});return json(200,{hash})}
    if(v.action==='library-add'){const x=verified.get(v.hash),media=cleanMedia(v.media);if(!x||!media)throw Error('Unknown download');if(!library.some(y=>y.hash===v.hash)){library.unshift({hash:v.hash,...media,release:x.release,path:x.path,size:x.size,added:Date.now()});saveLibrary()}return json(200,{ok:true})}
    // Movies the user hid from the catalogs, kept until unhidden from the settings
    if(v.action==='hide'||v.action==='unhide'){const id=String(v.id||v.item?.id||'');if(!/^tt\d{1,10}$/.test(id))throw Error('Unknown movie');const str=(x,n)=>typeof x==='string'?x.slice(0,n):'';
     let hidden=(Array.isArray(settings.hidden)?settings.hidden:[]).filter(x=>x.id!==id);if(v.action==='hide')hidden.unshift({id,name:str(v.item?.name,200),poster:/^https:\/\//.test(v.item?.poster)?str(v.item.poster,500):'',year:str(String(v.item?.year??''),10),at:Date.now()});
     settings.hidden=hidden.slice(0,5000);saveSettings();return json(200,{hidden:settings.hidden})}
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
     if(waiting.some(w=>w.hash===v.hash)){waiting=waiting.filter(w=>w.hash!==v.hash);saveWaiting();return json(200,{ok:true})}
     const job=jobs.get(v.hash);if(!job)throw Error('Unknown transfer');await client.remove(v.hash);jobs.delete(v.hash);persist();pump();return json(200,{ok:true});
    }
    const hash=await add(v);return json(200,{hash});
   }catch(e){return json(400,{error:e.message||'Could not add torrent'})}
  }
  const match=/^\/media-file\/([a-f0-9]{40})\/(\d+)$/.exec(u.pathname);
  if(match&&(req.method==='GET'||req.method==='HEAD')){
   if(!jobs.has(match[1]))await wake(match[1]);
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
 // A stream stops a few seconds after the player stops reading from it (the player was closed), so it doesn't keep
 // using the connection. Seeking reconnects right away and a paused player keeps its connection open. Streams that
 // never started playing get 10 minutes to find peers and 1 minute once they have them.
 // A stopped stream starts again when the player asks for it within 30 minutes (resuming after a long pause)
 const sleeping=new Map();
 async function wake(hash){const v=sleeping.get(hash);if(!v||Date.now()-v.at>1800000||jobs.has(hash))return;sleeping.delete(hash);try{await add(v);const t=jobs.get(hash)?.torrent;if(t&&!t.ready)await Promise.race([new Promise(r=>t.once('ready',r)),new Promise(r=>setTimeout(r,30000))])}catch{}}
 const streamIdle=options.streamIdleMs??5000,idleTimer=setInterval(()=>{for(const [hash,j] of jobs)if(j.mode==='stream'&&!j.open&&Date.now()-j.used>(j.played?streamIdle:Math.max(streamIdle,j.torrent.ready?60000:600000))){if(j.played)sleeping.set(hash,{magnet:j.torrent.magnetURI,mode:'stream',title:j.title,media:j.media,at:Date.now()});jobs.delete(hash);persist();Promise.resolve().then(()=>client.remove(hash)).catch(()=>{}).then(pump)}},Math.min(1000,streamIdle/4));idleTimer.unref?.();
 // Only unfinished downloads are resumed after a restart. Streams were for watching at that moment, restarting them
 // would download the movie again in the background, and movies already in the library are never fetched twice.
 const inLibrary=v=>{try{const hash=new URL(v.magnet).searchParams.get('xt').split(':').pop().toLowerCase();return library.some(x=>x.hash===hash)}catch{return false}};
 let restored=false;const restore=async()=>{if(restored)return;restored=true;for(const v of saved.filter(v=>v.mode==='download'&&!inLibrary(v)).slice(0,10))try{await add(v)}catch{}await pump()};
 return {server,client,add,snapshot,restore,close:()=>new Promise(resolve=>{clearInterval(idleTimer);server.close(()=>client.destroy(resolve))})};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const e=createEngine();e.server.listen(Number(process.env.SEANIME_MEDIA_PORT||11437),'127.0.0.1',()=>console.log('Media torrent engine listening on loopback'));
 const shutdown=()=>{e.server.close();e.client.destroy(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref()};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
