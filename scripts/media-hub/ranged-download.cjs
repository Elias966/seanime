'use strict';
// Some file hosts only answer byte ranges: AnimeKaizoku's file server fails a whole-file request with Cloudflare
// error 1101, and how big a range it manages changes with its load (20 MB at a quiet moment, 256 KB at a busy one).
// Such a file is fetched in pieces that shrink when the server fails one and grow back while it keeps up, and
// written into place. RangedItem acts like Electron's DownloadItem, so the download list treats both the same.
const fs=require('fs'),path=require('path'),{EventEmitter}=require('events');
const MB=1024*1024,MIN=MB/4,MAX=16*MB,PARALLEL=3,TRIES=8;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function dispositionName(h){
 if(!h)return '';
 const star=/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(h);if(star)try{return decodeURIComponent(star[1].trim().replace(/^"|"$/g,''))}catch{}
 const plain=/filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(h);return plain?(plain[1]??plain[2]).trim():'';
}

/** Asks for the first byte, a few times since the host may be busy. Resolves with the file's name and size when it serves ranges. */
async function probe(fetch,url,tries=4,wait=t=>1500*t){
 for(let t=1;;t++){
  const res=await fetch(url,{Range:'bytes=0-0'});
  const range=/^bytes 0-0\/(\d+)$/.exec(res.headers.get('content-range')||'');
  if(res.status===206&&range){
   res.body?.cancel?.().catch(()=>{});
   let name=dispositionName(res.headers.get('content-disposition'));
   if(!name)try{name=decodeURIComponent(path.basename(new URL(res.url||url).pathname))}catch{}
   return {name,total:+range[1]};
  }
  const type=res.headers.get('content-type')||'',text=(await res.text().catch(()=>'')).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  if(t<tries&&res.status>=500){await sleep(wait(t));continue}
  const why=/^text\/plain/.test(type)?text.slice(0,60):/Error 1101|Worker threw/.test(text)?'error 1101':'';
  throw Error(`The file server answered with an error (HTTP ${res.status}${why?', '+why:''}), try again later`);
 }
}

class RangedItem extends EventEmitter{
 constructor(fetch,url,name,total){
  super();
  Object.assign(this,{fetch,url,name,total,file:'',state:'progressing',paused:false,stalled:false,problem:'',got:0,live:new Set(),todo:[],cursor:0,size:4*MB,slots:PARALLEL,wins:0,wait:t=>Math.min(60000,1000*2**t),retryAfter:120000});
 }
 getURL(){return this.url}
 getURLChain(){return [this.url]}
 getFilename(){return this.name}
 getMimeType(){return ''}
 setSavePath(file){this.file=file}
 getSavePath(){return this.file}
 getTotalBytes(){return this.total}
 getReceivedBytes(){let n=this.got;for(const p of this.live)n+=p.got;return n}
 isPaused(){return this.paused}
 canResume(){return this.state==='progressing'&&(this.paused||this.stalled)}
 begin(){this.fd=fs.openSync(this.file,'w');this.timer=setInterval(()=>this.emit('updated',{},this.stalled?'interrupted':'progressing'),700);this.pump()}
 pause(){if(this.state!=='progressing'||this.paused)return;this.paused=true;for(const p of this.live)p.ctl.abort()}
 resume(){if(!this.canResume())return;this.paused=false;this.stalled=false;this.problem='';clearTimeout(this.again);this.slots=1;this.pump()}
 cancel(){if(this.state!=='progressing')return;this.finish('cancelled')}
 // The next range: one handed back by a stopped or failed piece first, then fresh bytes
 take(){
  if(this.todo.length)return this.todo.shift();
  if(this.cursor>=this.total)return null;
  const from=this.cursor,to=Math.min(this.total,from+this.size)-1;this.cursor=to+1;return {from,to};
 }
 give(r){this.todo.push(r);this.todo.sort((a,b)=>a.from-b.from)}
 pump(){
  if(this.state!=='progressing'||this.paused||this.stalled)return;
  if(!this.todo.length&&this.cursor>=this.total&&!this.live.size)return this.finish(this.getReceivedBytes()===this.total?'completed':'interrupted');
  while(this.live.size<this.slots){const r=this.take();if(!r)break;this.piece(r)}
 }
 async piece(r){
  const p={...r,got:0,ctl:new AbortController()};this.live.add(p);
  const back=()=>{this.live.delete(p);this.give({from:p.from,to:p.to})};
  for(let t=1;;t++){
   p.got=0;
   try{
    const res=await this.fetch(this.url,{Range:`bytes=${p.from}-${p.to}`},p.ctl.signal);
    if(res.status!==206||!(res.headers.get('content-range')||'').startsWith(`bytes ${p.from}-${p.to}/`)){res.body?.cancel?.().catch(()=>{});throw Error(`HTTP ${res.status}`)}
    const reader=res.body.getReader(),len=p.to-p.from+1;
    for(;;){const {done,value}=await reader.read();if(done)break;if(p.got+value.length>len)throw Error('The file server sent too much');fs.writeSync(this.fd,value,0,value.length,p.from+p.got);p.got+=value.length}
    if(p.got!==len)throw Error('The file server stopped early');
    this.got+=len;p.got=0;this.live.delete(p);this.problem='';
    // While the server keeps up, pieces grow back and the other connections return
    if(++this.wins>=4){this.wins=0;this.size=Math.min(MAX,this.size*2);this.slots=Math.min(PARALLEL,this.slots+1)}
    return this.pump();
   }catch(e){
    if(this.state!=='progressing')return;
    // A piece stopped by a pause goes back in the queue and is fetched again from its start
    if(p.ctl.signal.aborted){back();return this.pump()}
    this.wins=0;this.slots=1;
    // The busy server manages smaller pieces, so a failed one is split before it is retried
    if(p.to-p.from+1>MIN){
     this.size=Math.max(MIN,Math.floor(this.size/2));this.live.delete(p);
     for(let a=p.from;a<=p.to;a+=this.size)this.give({from:a,to:Math.min(p.to,a+this.size-1)});
     await sleep(this.wait(0));return this.pump();
    }
    if(t>=TRIES){back();return this.stall(e)}
    this.problem='The file server is busy, retrying';
    await sleep(this.wait(t));
    if(this.paused||this.stalled||this.state!=='progressing'){back();return this.pump()}
   }
  }
 }
 // The server stopped answering: the pieces so far are kept, and the download waits and starts again by itself
 stall(e){
  if(this.stalled)return;this.stalled=true;
  this.problem=`The file server is not answering (${e.message}), trying again in ${Math.max(1,Math.round(this.retryAfter/60000))} min`;
  for(const p of this.live)p.ctl.abort();
  this.emit('updated',{},'interrupted');
  this.again=setTimeout(()=>this.resume(),this.retryAfter);
 }
 finish(state){
  if(this.state!=='progressing')return;this.state=state;clearInterval(this.timer);clearTimeout(this.again);
  for(const p of this.live)p.ctl.abort();this.live.clear();
  try{fs.closeSync(this.fd)}catch{}
  this.emit('done',{},state);
 }
}

module.exports={probe,RangedItem,dispositionName,MAX};
