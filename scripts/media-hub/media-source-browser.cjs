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
function createRelay({port=11438,request=upstream}={}){
 const resources=new Map(),contexts=new Map();
 function context(sourceId){const c={id:crypto.randomUUID(),sourceId,headers:new Map(),keys:new Map(),created:Date.now()};contexts.set(c.id,c);return c}
 function register(c,url,kind,headers,headerOrigin=new URL(url).origin){
  const u=new URL(url);if(u.protocol!=='https:')throw Error('Only HTTPS source media is supported');
  if(c.keys.has(url))return c.keys.get(url);
  if(resources.size>4096){for(const[k,v]of resources)if(Date.now()-v.used>3600000)resources.delete(k);if(resources.size>4096)throw Error('Too many source resources')}
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
   const r=await request(record.url,headers);const type=String(r.headers['content-type']||'application/octet-stream');
   if(r.statusCode>=400){r.resume();res.writeHead(r.statusCode);res.end();return}
   if(record.kind==='hls'||/mpegurl/i.test(type)){
    let bytes=0,parts=[];for await(const b of r){bytes+=b.length;if(bytes>2*1024*1024)throw Error('Playlist too large');parts.push(b)}
    let text=Buffer.concat(parts).toString('utf8');if(!text.trimStart().startsWith('#EXTM3U'))throw Error('Not a media playlist');
    const child=value=>{const url=new URL(value,r.sourceURL||record.url).href;return register(record.c,url,mediaKind(url)||'segment',record.headers,record.headerOrigin)};
    text=text.split(/\r?\n/).map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,uri)=>'URI="'+child(uri)+'"'):line.trim()?child(line.trim()):line).join('\n');const b=Buffer.from(text);res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl','Content-Length':b.length,'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:b);return;
   }
   const out={'Content-Type':type,'Cache-Control':'no-store','Accept-Ranges':'bytes'};for(const key of ['content-length','content-range'])if(r.headers[key])out[key]=r.headers[key];res.writeHead(r.statusCode||200,out);if(req.method==='HEAD'){r.resume();res.end();return}res.on('close',()=>r.destroy());r.on('error',()=>res.destroy());r.pipe(res);
  }catch{if(!res.headersSent)res.writeHead(502);res.end()}
 });
 server.on('error',()=>{});return {server,context,register,resources};
}
function attach(win,options={}){
 const registry=options.registry||JSON.parse(fs.readFileSync(path.join(process.resourcesPath,'media-hub','sources.json'),'utf8'));
 const relay=createRelay();relay.server.listen(11438,'127.0.0.1');let count=0;
 win.webContents.on('did-attach-webview',(_,guest)=>{
  const marker=/SeanimeSource\/([a-z0-9-]+)/.exec(guest.getUserAgent());if(!marker)return;const source=registry.sources.find(s=>s.id===marker[1]&&s.mode!=='unavailable');if(!source){guest.close();return}
  const c=relay.context(source.id);const origins=new Set([source.url,source.browseUrl,...source.alternateUrls].filter(Boolean).map(u=>new URL(u).origin));const emit=data=>{if(!win.isDestroyed())win.webContents.send('media-source:event',{sourceId:source.id,guestId:guest.id,...data})};const seen=new Set();count++;
  guest.setWindowOpenHandler(({url})=>{if(url.startsWith('magnet:?'))emit({type:'magnet',magnet:url});return {action:'deny'}});
  const navigation=(e,url)=>{if(url.startsWith('magnet:?')){e.preventDefault();emit({type:'magnet',magnet:url});return}try{const u=new URL(url);if(!['http:','https:','about:'].includes(u.protocol))e.preventDefault();else if(u.protocol!=='about:'&&!origins.has(u.origin)){e.preventDefault();const kind=mediaKind(u.href);if(kind&&kind!=='subtitle')emit({type:kind,url:relay.register(c,u.href,kind),label:guest.getTitle()||source.name});else emit({type:'blocked-navigation',host:u.hostname})}}catch{e.preventDefault()}};
  guest.on('page-title-updated',(_,title)=>{if(/^(just a moment|attention required|security verification|captcha)/i.test(title)){guest.stop();guest.loadURL('about:blank');emit({type:'verification-required'})}});
  guest.on('will-navigate',navigation);guest.on('will-redirect',navigation);
  guest.session.webRequest.onBeforeSendHeaders({urls:['https://*/*']},(details,callback)=>{try{const u=new URL(details.url);c.headers.set(u.origin,{...details.requestHeaders})}catch{}callback({requestHeaders:details.requestHeaders})});
  guest.session.webRequest.onCompleted({urls:['https://*/*']},details=>{
   if(details.statusCode<200||details.statusCode>=300||seen.has(details.url))return;const h=details.responseHeaders||{},type=Object.entries(h).find(([k])=>k.toLowerCase()==='content-type')?.[1]?.[0]||'';let kind;try{kind=mediaKind(details.url,type)}catch{return}if(!kind)return;
   seen.add(details.url);try{emit({type:kind,url:relay.register(c,details.url,kind,c.headers.get(new URL(details.url).origin)),label:decodeURIComponent(new URL(details.url).pathname.split('/').pop()||kind),originalHost:new URL(details.url).hostname})}catch{}
  });
  // Provider pages run without a preload, Node access or popup permissions.
  // Requests remain visible so their original media headers can be relayed only
  // to registered public HTTPS URLs; no arbitrary URL-fetch IPC is exposed.
  const download=(e,item,contents)=>{if(contents!==guest)return;const url=item.getURL();if(url.startsWith('magnet:?')){e.preventDefault();emit({type:'magnet',magnet:url});return}if(/\.torrent(?:\?|$)/i.test(url)||/bittorrent/i.test(item.getMimeType())){e.preventDefault();try{emit({type:'torrent-link',url:relay.register(c,url,'torrent',c.headers.get(new URL(url).origin)),label:item.getFilename()})}catch{}return}if(!/\.(mp4|mkv|webm|m4v|srt|ass|ssa|vtt|zip|7z)$/i.test(item.getFilename()))e.preventDefault()};guest.session.on('will-download',download);
  guest.once('destroyed',()=>{count--;guest.session.removeListener('will-download',download);});
 });
 win.once('closed',()=>relay.server.close());return relay;
}
module.exports={publicIP,mediaKind,allowedOrigin,publicAddress,upstream,createRelay,attach};
