/* Integrated, loopback-only movie/anime torrent playback. GPL-3.0. */
import WebTorrent from 'webtorrent';
import parseTorrent,{toTorrentFile} from 'parse-torrent';
import http from 'node:http';
import fs from 'node:fs';
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
 function snapshot(){for(const j of jobs.values())record(j);return [...jobs.values()].map(({torrent:t,mode,title,error})=>({hash:t.infoHash,title:title||t.name||'Resolving metadata…',mode,error,ready:t.ready,progress:t.progress||0,downloaded:t.downloaded||0,length:t.length||0,downloadSpeed:t.downloadSpeed||0,peers:t.numPeers||0,files:t.files?.map((f,i)=>({index:i,name:f.name,length:f.length,playable:/\.(mp4|m4v|webm|mkv|mov)$/i.test(f.name),url:'/media-file/'+t.infoHash+'/'+i}))||[]}))}
 function persist(){fs.writeFileSync(savedFile+'.tmp',JSON.stringify([...jobs.values()].map(j=>({magnet:j.torrent.magnetURI,mode:j.mode,title:j.title,media:j.media}))));fs.renameSync(savedFile+'.tmp',savedFile)}
 // Finished movie downloads are kept in library.json, they stay playable from disk after the transfer is stopped.
 const libraryFile=path.join(directory,'library.json');let library=[];try{library=JSON.parse(fs.readFileSync(libraryFile,'utf8'))}catch{}
 function saveLibrary(){fs.writeFileSync(libraryFile+'.tmp',JSON.stringify(library));fs.renameSync(libraryFile+'.tmp',libraryFile)}
 const libraryPath=x=>{const p=path.resolve(directory,x.file);return p.startsWith(path.resolve(directory)+path.sep)?p:null};
 function record(job){
  const t=job.torrent;if(job.mode!=='download'||!job.media||!t.ready||t.progress<1||library.some(x=>x.hash===t.infoHash))return;
  const f=t.files.filter(f=>/\.(mp4|m4v|webm|mkv|mov)$/i.test(f.name)).sort((a,b)=>b.length-a.length)[0];if(!f)return;
  library.unshift({hash:t.infoHash,...job.media,release:job.title,file:f.path,size:f.length,added:Date.now()});try{saveLibrary()}catch{}
 }
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
  const t=client.add(metadata||magnet,{path:directory,deselect:value.mode!=='download'});const job={torrent:t,mode:value.mode==='download'?'download':'stream',title:String(value.title||'').slice(0,180),media,error:''};t.on('error',()=>{});if(!t.infoHash)await new Promise((resolve,reject)=>{t.once('infoHash',resolve);t.once('error',reject)});jobs.set(t.infoHash,job);
  t.on('error',()=>{job.error='Torrent connection failed'});t.on('done',()=>record(job));t.once('ready',()=>{try{fs.writeFileSync(path.join(metadataDir,t.infoHash+'.torrent'),t.torrentFile)}catch{}if(job.mode==='stream')for(const f of t.files)f.deselect();persist()});persist();return t.infoHash;
 }
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1'),origin=req.headers.origin;
  if(!allowedOrigin(origin)){res.writeHead(403);res.end();return}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
  function json(status,value){const b=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(b),'Cache-Control':'no-store'});res.end(b)}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});res.end();return}
  if(req.method==='GET'&&u.pathname==='/health')return json(200,{ok:true,revision:'media-engine-v2'});
  if(req.method==='GET'&&u.pathname==='/torrents')return json(200,snapshot());
  if(req.method==='GET'&&u.pathname==='/library')return json(200,library.filter(x=>{const p=libraryPath(x);return p&&fs.existsSync(p)}).map(x=>({...x,url:'/library-file/'+x.hash})));
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
   const t=jobs.get(match[1])?.torrent,file=t?.files?.[Number(match[2])];if(!file||!t.ready)return json(404,{error:'Torrent metadata is not ready'});
   const range=parseRange(req.headers.range,file.length);if(!range){res.writeHead(416,{'Content-Range':'bytes */'+file.length});res.end();return}
   const headers={'Content-Type':mimeFor(file.name),'Content-Length':range.end-range.start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store'};if(range.status===206)headers['Content-Range']=`bytes ${range.start}-${range.end}/${file.length}`;
   res.writeHead(range.status,headers);if(req.method==='HEAD'){res.end();return}
   const stream=file.createReadStream({start:range.start,end:range.end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
  }
  json(404,{error:'Unknown endpoint'});
 });
 // Restore transfers only after the user explicitly opens Downloads, avoiding
 // unsolicited network activity or downloads merely from launching Seanime.
 let restored=false;const restore=async()=>{if(restored)return;restored=true;for(const v of saved.slice(0,10))try{await add(v)}catch{}};
 return {server,client,add,snapshot,restore,close:()=>new Promise(resolve=>{server.close(()=>client.destroy(resolve))})};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const e=createEngine();e.server.listen(Number(process.env.SEANIME_MEDIA_PORT||11437),'127.0.0.1',()=>console.log('Media torrent engine listening on loopback'));
 const shutdown=()=>{e.server.close();e.client.destroy(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref()};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
