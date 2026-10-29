/* Isolated source browsing and capability-scoped media relay. GPL-3.0. */
const http=require('node:http'),https=require('node:https'),dns=require('node:dns').promises,net=require('node:net'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
function publicIP(ip){
 if(ip.startsWith('::ffff:'))return publicIP(ip.slice(7));
 if(net.isIP(ip)===4){const[a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19))}
 return net.isIP(ip)===6&&/^[23][0-9a-f]{3}:/i.test(ip);
}
function mediaKind(url,type=''){
 const p=new URL(url).pathname.toLowerCase();type=type.toLowerCase();
 if(/\.m3u8$/.test(p)||/mpegurl/.test(type))return 'hls';
 if(/\.(srt|vtt|ass|ssa)$/.test(p)||/text\/(vtt|srt)|subrip|x-ssa|x-ass/.test(type))return 'subtitle';
 if(/\.(mp4|m4v|webm|mkv|mov)$/.test(p)||/^video\/(mp4|webm|x-matroska|quicktime)/.test(type))return 'video';
 return null;
}
function allowedOrigin(o){if(!o||o==='app://-')return true;try{const u=new URL(o);return ['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)}catch{return false}}
async function publicAddress(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw Error('Only public HTTPS media is supported');const all=net.isIP(u.hostname)?[{address:u.hostname.replace(/^\[|\]$/g,''),family:net.isIP(u.hostname)}]:await dns.lookup(u.hostname,{all:true});const ip=all.find(x=>x.family===4&&publicIP(x.address))||all.find(x=>publicIP(x.address));if(!ip)throw Error('Private media destinations are blocked');return {u,ip}}
async function upstream(url,headers={},redirects=0){
 const {u,ip}=await publicAddress(url);
 return new Promise((resolve,reject)=>{
  const req=https.get(u,{headers,lookup:(_,options,cb)=>options?.all?cb(null,[ip]):cb(null,ip.address,ip.family)},r=>{
   if([301,302,303,307,308].includes(r.statusCode)&&r.headers.location){r.resume();if(redirects>=4)return reject(Error('Too many source redirects'));const next=new URL(r.headers.location,u);const clean={...headers};if(next.origin!==u.origin){delete clean.Cookie;delete clean.cookie;delete clean.Authorization;delete clean.authorization}upstream(next.href,clean,redirects+1).then(resolve,reject);return}
   r.sourceURL=u.href;resolve(r);
  });req.setTimeout(25000,()=>req.destroy(Error('Source timed out')));req.on('error',reject);
 });
}
// Fetch through the source page's own Chromium session: video hosts behind Cloudflare
// reject Node's TLS client even with identical headers. The session outlives the page.
async function sessionUpstream(session,url,headers={}){
 await publicAddress(url);
 const {referer,Referer,cookie,Cookie,...rest}=headers,referrer=referer||Referer;
 // The referrer option is not sent by session.fetch, and CDNs that check it answer 403, so it goes in as a header.
 // uBlock Origin judges a request with a Referer as the site's own and may block it; that request then goes out
 // from Node instead (the page already loaded the media, so it is not an ad), and each header set is also tried without one.
 const go=h=>session.fetch(url,{headers:h,redirect:'follow',bypassCustomProtocolHandlers:true});
 // Some captured header sets are refused by Chromium when replayed, fall back to the ones a media request needs
 const basic=Object.fromEntries(Object.entries(rest).filter(([k])=>/^(accept|accept-language|user-agent|origin|range)$/i.test(k)));const {origin,Origin,...plain}=basic;
 const ref=h=>referrer?{...h,Referer:referrer}:h,tries=[rest,basic,plain].flatMap(h=>referrer?[ref(h),h]:[h]),errors=[];
 let res;for(const h of tries){try{res=await go(h);break}catch(e){errors.push(e.message);if(h.Referer&&/ERR_BLOCKED_BY_CLIENT/.test(e.message)){try{return await upstream(url,h)}catch(n){errors.push(n.message)}}}}
 if(!res)throw Error(`${errors.join(' / ')} [${Object.keys(rest).join(',')}]`);
 if(res.url&&res.url!==url)await publicAddress(res.url);
 const {Readable}=require('node:stream');const r=res.body?Readable.fromWeb(res.body):Readable.from([]);
 r.statusCode=res.status;r.headers=Object.fromEntries(res.headers);r.sourceURL=res.url||url;return r;
}
const MAX_RESOURCES=20000;
function createRelay({port=11438,request=upstream}={}){
 const resources=new Map(),contexts=new Map();
 function context(sourceId){const c={id:crypto.randomUUID(),sourceId,headers:new Map(),keys:new Map(),created:Date.now()};contexts.set(c.id,c);return c}
 function register(c,url,kind,headers,headerOrigin=new URL(url).origin){
  const u=new URL(url);if(u.protocol!=='https:')throw Error('Only HTTPS source media is supported');
  const known=c.keys.get(url);if(known&&resources.has(known.split('/')[4]))return known;
  // A single HLS movie registers thousands of segments, so drop the least recently used ones instead of refusing new media.
  if(resources.size>=MAX_RESOURCES){const old=[...resources].sort((a,b)=>a[1].used-b[1].used).slice(0,resources.size-MAX_RESOURCES+1024);for(const[k]of old)resources.delete(k)}
  const key=crypto.randomUUID(),extension=kind==='hls'?'.m3u8':kind==='subtitle'?(/\.(srt|vtt|ass|ssa)$/i.exec(u.pathname)?.[0]||'.vtt'):kind==='torrent'?'.torrent':kind==='video'?(/\.(mp4|webm|mkv|m4v|mov)$/i.exec(u.pathname)?.[0]||'.mp4'):'';
  const local='http://127.0.0.1:'+(server.address()?.port||port)+'/source/'+key+'/stream'+extension;
  resources.set(key,{url,c,kind,headers:headers||{},headerOrigin,used:Date.now()});c.keys.set(url,local);return local;
 }
 const server=http.createServer(async(req,res)=>{
  if(!allowedOrigin(req.headers.origin)){res.writeHead(403);res.end();return}
  if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range'});res.end();return}
  if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,revision:'media-source-relay-v1'}));return}
  const m=/^\/source\/([a-f0-9-]{36})\/stream(?:\.[a-z0-9]+)?$/.exec(req.url);const record=m&&resources.get(m[1]);if(!record||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return}
  record.used=Date.now();const sourceOrigin=new URL(record.url).origin;const sameHeaders=record.headerOrigin===sourceOrigin;const sourceHeaders=record.c.headers.get(sourceOrigin)||Object.fromEntries(Object.entries(record.headers).filter(([k])=>sameHeaders||!/^(cookie|authorization)$/i.test(k)));const headers={};for(const[k,v]of Object.entries(sourceHeaders||{}))if(/^(user-agent|origin|referer|cookie|authorization|accept)$/i.test(k))headers[k]=v;
  if(req.headers.range){if(!/^bytes=\d+-\d*$/.test(req.headers.range)){res.writeHead(416);res.end();return}headers.Range=req.headers.range}
  try{
   // CDNs rate limit the playlist the site's own player just loaded, give them a moment before giving up
   let r=await request(record.url,headers,record.c);for(let i=0;i<2&&r.statusCode===429;i++){r.resume();await new Promise(x=>setTimeout(x,1500*(i+1)));r=await request(record.url,headers,record.c)}const type=String(r.headers['content-type']||'application/octet-stream');
   if(r.statusCode>=400){r.resume();res.writeHead(r.statusCode);res.end();return}
   if(record.kind==='hls'||/mpegurl/i.test(type)){
    let bytes=0,parts=[];for await(const b of r){bytes+=b.length;if(bytes>2*1024*1024)throw Error('Playlist too large');parts.push(b)}
    let text=Buffer.concat(parts).toString('utf8');if(!text.trimStart().startsWith('#EXTM3U'))throw Error('Not a media playlist');
    const child=(value,playlist)=>{const url=new URL(value,r.sourceURL||record.url).href;return register(record.c,url,playlist?'hls':mediaKind(url)||'segment',record.headers,record.headerOrigin)};
    // Variant and rendition playlists are often disguised (.jpg, no extension), so their kind comes from the tag pointing at them.
    let variant=false;text=text.split(/\r?\n/).map(line=>{if(line.startsWith('#')){variant=/^#EXT-X-STREAM-INF/i.test(line);const rendition=/^#EXT-X-(MEDIA|I-FRAME-STREAM-INF):/i.test(line);return line.replace(/URI="([^"]+)"/g,(_,uri)=>'URI="'+child(uri,rendition)+'"')}if(!line.trim())return line;const out=child(line.trim(),variant);variant=false;return out}).join('\n');const b=Buffer.from(text);res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl','Content-Length':b.length,'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:b);return;
   }
   const out={'Content-Type':type,'Cache-Control':'no-store','Accept-Ranges':'bytes'};for(const key of ['content-length','content-range'])if(r.headers[key])out[key]=r.headers[key];res.writeHead(r.statusCode||200,out);if(req.method==='HEAD'){r.resume();res.end();return}res.on('close',()=>r.destroy());r.on('error',()=>res.destroy());r.pipe(res);
  }catch(e){if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain'});res.end(String(e?.message||'Upstream failed').slice(0,200))}
 });
 server.on('error',()=>{});return {server,context,register,resources};
}
// Direct-download sources (openNavigation) save files straight into the folder the app picked for them.
const DDL_FILE=/\.(mp4|m4v|mkv|webm|avi|zip|7z|rar|srt|ass|ssa|vtt)$/i;
function safeName(name){return String(name||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^[.\s]+/,'').slice(0,200)||'download'}
function freePath(dir,name){const ext=path.extname(name),base=name.slice(0,name.length-ext.length);let p=path.join(dir,name);for(let i=1;fs.existsSync(p)||fs.existsSync(p+'.part');i++)p=path.join(dir,base+' ('+i+')'+ext);return p}
function attachDownloads(win,registry){
 const {ipcMain,session,app}=require('electron');const dirs=new Map(),items=new Map();
 const sources=registry.sources.filter(s=>s.openNavigation&&s.mode!=='unavailable'),partition=id=>session.fromPartition('persist:seanime-media-source-'+id);
 // uBlock Origin keeps the download sites' ad scripts and click-trap popups out of the way.
 const ubo=path.join(__dirname,'ublock-origin');if(fs.existsSync(path.join(ubo,'manifest.json')))for(const source of sources){const s=partition(source.id);(s.extensions||s).loadExtension(ubo,{allowFileAccess:false}).catch(e=>console.warn('uBlock Origin:',e.message))}
 const send=d=>{if(!win.isDestroyed())win.webContents.send('media-source:event',{type:'download',...d})};
 for(const source of sources)partition(source.id).on('will-download',(e,item)=>{
  const name=safeName(item.getFilename());if(!DDL_FILE.test(name))return;
  const dir=dirs.get(source.id)||path.join(app.getPath('downloads'),'Seanime');try{fs.mkdirSync(dir,{recursive:true})}catch{}
  const file=freePath(dir,name),id=crypto.randomUUID();item.setSavePath(file);items.set(id,item);let last=0;
  const report=state=>send({id,sourceId:source.id,name:path.basename(file),path:file,received:item.getReceivedBytes(),total:item.getTotalBytes(),state});
  report('progressing');
  item.on('updated',(_,state)=>{const now=Date.now();if(state==='progressing'&&now-last<700)return;last=now;report(state==='interrupted'?'interrupted':'progressing')});
  // Electron writes straight to the chosen file, so a cancelled or failed download leaves a partial one.
  item.once('done',(_,state)=>{items.delete(id);report(state);if(state!=='completed')fs.rm(file,{force:true},()=>{})});
 });
 ipcMain.on('media-source:download',(e,msg)=>{
  if(e.sender!==win.webContents||!msg||typeof msg!=='object')return;const source=sources.find(s=>s.id===msg.sourceId);
  if(msg.action==='dir'&&source&&typeof msg.dir==='string'&&path.isAbsolute(msg.dir)&&!msg.dir.includes('\0'))dirs.set(source.id,path.normalize(msg.dir));
  else if(msg.action==='start'&&source){try{const u=new URL(msg.url);if(u.protocol==='https:')partition(source.id).downloadURL(u.href,typeof msg.referer==='string'&&/^https:\/\//.test(msg.referer)?{headers:{Referer:msg.referer}}:undefined)}catch{}}
  else if(msg.action==='cancel'&&typeof msg.id==='string')items.get(msg.id)?.cancel();
 });
}
function attach(win,options={}){
 const registry=options.registry||JSON.parse(fs.readFileSync(path.join(process.resourcesPath,'media-hub','sources.json'),'utf8'));
 const {session}=require('electron');
 const relay=createRelay({request:options.request||((url,headers,c)=>sessionUpstream(session.fromPartition('persist:seanime-media-source-'+c.sourceId),url,headers))});relay.server.listen(11438,'127.0.0.1');let count=0;if(!options.registry)attachDownloads(win,registry);
 win.webContents.on('did-attach-webview',(_,guest)=>{
  const marker=/SeanimeSource\/([a-z0-9-]+)/.exec(guest.getUserAgent());if(!marker)return;const source=registry.sources.find(s=>s.id===marker[1]&&s.mode!=='unavailable');if(!source){guest.close();return}
  const c=relay.context(source.id);const origins=new Set([source.url,source.browseUrl,...source.alternateUrls].filter(Boolean).map(u=>new URL(u).origin));const emit=data=>{if(!win.isDestroyed())win.webContents.send('media-source:event',{sourceId:source.id,guestId:guest.id,...data})};const seen=new Set();count++;
  guest.setWindowOpenHandler(({url})=>{if(url.startsWith('magnet:?'))emit({type:'magnet',magnet:url});else if(source.openNavigation&&/^https:\/\//.test(url))emit({type:'popup',url});return {action:'deny'}});
  // Only top-level navigation is restricted; sites embed their players from other hosts in frames.
  const navigation=(e,url)=>{if(e.isMainFrame===false)return;if(url.startsWith('magnet:?')){e.preventDefault();emit({type:'magnet',magnet:url});return}try{const u=new URL(url);if(!['http:','https:','about:'].includes(u.protocol))e.preventDefault();else if(u.protocol!=='about:'&&!origins.has(u.origin)&&!(source.openNavigation&&u.protocol==='https:')){e.preventDefault();const kind=mediaKind(u.href);if(kind&&kind!=='subtitle')emit({type:kind,url:relay.register(c,u.href,kind),label:guest.getTitle()||source.name});else emit({type:'blocked-navigation',host:u.hostname})}}catch{e.preventDefault()}};
  guest.on('page-title-updated',(_,title)=>{if(!source.openNavigation&&/^(just a moment|attention required|security verification|captcha)/i.test(title)){guest.stop();guest.loadURL('about:blank');emit({type:'verification-required'})}});
  guest.on('will-navigate',navigation);guest.on('will-redirect',navigation);
  // Download sites skip stream sniffing: session.webRequest hooks would shadow uBlock Origin's.
  if(!source.openNavigation){guest.session.webRequest.onBeforeSendHeaders({urls:['https://*/*']},(details,callback)=>{try{const u=new URL(details.url);c.headers.set(u.origin,{...details.requestHeaders})}catch{}callback({requestHeaders:details.requestHeaders})});
  // onResponseStarted, not onCompleted: a progressive video stays open for the whole movie.
  guest.session.webRequest.onResponseStarted({urls:['https://*/*']},details=>{
   if(details.statusCode<200||details.statusCode>=300||seen.has(details.url))return;const h=details.responseHeaders||{},type=Object.entries(h).find(([k])=>k.toLowerCase()==='content-type')?.[1]?.[0]||'';let kind;try{kind=mediaKind(details.url,type)||(details.resourceType==='media'&&/^(application\/octet-stream|binary\/octet-stream)?$/i.test(type)?'video':null)}catch{return}if(!kind)return;
   seen.add(details.url);try{emit({type:kind,url:relay.register(c,details.url,kind,c.headers.get(new URL(details.url).origin)),label:decodeURIComponent(new URL(details.url).pathname.split('/').pop()||kind),originalHost:new URL(details.url).hostname})}catch{}
  });}
  // Provider pages run without a preload, Node access or popup permissions.
  // Requests remain visible so their original media headers can be relayed only
  // to registered public HTTPS URLs; no arbitrary URL-fetch IPC is exposed.
  const download=(e,item,contents)=>{if(contents!==guest)return;const url=item.getURL();if(url.startsWith('magnet:?')){e.preventDefault();emit({type:'magnet',magnet:url});return}if(/\.torrent(?:\?|$)/i.test(url)||/bittorrent/i.test(item.getMimeType())){e.preventDefault();try{emit({type:'torrent-link',url:relay.register(c,url,'torrent',c.headers.get(new URL(url).origin)),label:item.getFilename()})}catch{}return}if(!DDL_FILE.test(item.getFilename()))e.preventDefault()};guest.session.on('will-download',download);
  const guestSession=guest.session;guest.once('destroyed',()=>{count--;guestSession.removeListener('will-download',download);});
 });
 win.once('closed',()=>relay.server.close());return relay;
}
module.exports={publicIP,mediaKind,allowedOrigin,publicAddress,upstream,sessionUpstream,createRelay,attach};
