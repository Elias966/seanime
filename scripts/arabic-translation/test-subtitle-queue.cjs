const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={module:{exports:{}},setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(__dirname+'/../../seanime-web/public/subtitle-translation-queue.js','utf8'),context);
const {createQueue}=context.module.exports;
function harness(extra={}){const sent=[],applied=[];const q=createQueue({send:text=>sent.push(text),apply:(item,text)=>applied.push({item,text}),...extra});return{q,sent,applied};}
test('a whole episode cannot exceed four outstanding model requests',()=>{
 const h=harness();for(let i=0;i<500;i++)h.q.enqueue('line '+i,{i});
 assert.equal(h.sent.length,4);assert.equal(h.q.stats().active,4);assert.equal(h.q.stats().pending,496);
 for(let i=0;i<500;i++){assert.equal(h.sent[i],'line '+i);h.q.accept(h.sent[i],'ترجمة '+i);assert.ok(h.q.stats().active<=4);}
 assert.equal(h.applied.length,500);assert.equal(h.q.stats().pending,0);assert.equal(h.q.stats().active,0);h.q.clear();
});
test('one translation reaches all repeated captions and later cached occurrences',()=>{
 const h=harness();h.q.enqueue('Hello',{start:1});h.q.enqueue('Hello',{start:9});h.q.enqueue('Hello',{start:20});
 assert.equal(h.sent.length,1);h.q.accept('Hello','مرحبا');assert.equal(h.applied.length,3);
 h.q.enqueue('Hello',{start:100});assert.equal(h.applied.length,4);assert.equal(h.sent.length,1);h.q.clear();
});
test('after a seek, upcoming dialogue is prioritized over stale queued captions',()=>{
 let now=0;const h=harness({getTime:()=>now,getStart:item=>item.start,getEnd:item=>item.start+1000});
 for(let i=0;i<4;i++)h.q.enqueue('active'+i,{start:i});
 h.q.enqueue('old',{start:100});h.q.enqueue('far',{start:90000});h.q.enqueue('near',{start:51000});
 now=50000;h.q.accept('active0','نعم');assert.equal(h.sent.at(-1),'near');h.q.clear();
});
test('lost response is retried once and cannot permanently block the queue',()=>{
 const timers=[];const h=harness({limit:1,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}});
 h.q.enqueue('lost',{id:1});h.q.enqueue('next',{id:2});timers[0]();assert.deepEqual(h.sent,['lost','lost']);
 timers[1]();assert.deepEqual(h.sent,['lost','lost','next']);assert.equal(h.applied[0].text,'lost');h.q.accept('next','التالي');
 assert.equal(h.q.stats().active,0);h.q.clear();
});
test('destroy cancels work and original-language fallback is not cached',()=>{
 const h=harness();h.q.enqueue('Hello',{id:1});h.q.accept('Hello','Hello');h.q.enqueue('Hello',{id:2});
 assert.equal(h.sent.length,2);h.q.clear();h.q.enqueue('after destroy',{});assert.equal(h.sent.length,2);
});
test('actual patched compiled player preserves every repeated ASS event',{skip:!process.env.SEANIME_PLAYER_BUNDLE},()=>{
 const raw=fs.readFileSync(process.env.SEANIME_PLAYER_BUNDLE,'utf8');
 const a=raw.indexOf('_queueEventTranslation(e){'),b=raw.indexOf('_getTracks(){',a);assert.ok(a>=0&&b>a);
 const ctx={window:{SeanimeCreateSubtitleTranslationQueue:createQueue}};vm.createContext(ctx);
 const Manager=vm.runInContext('(class{'+raw.slice(a,b)+'})',ctx),m=new Manager(),sent=[],rendered=[];
 m.videoElement={currentTime:0};m.currentTrackNumber=3;m.sendTranslateRequest=text=>sent.push(text);
 m.libassRenderer={renderer:{createEvent:event=>rendered.push(event)}};
 for(const start of [100,1000,9000])m._queueEventTranslation({event:{text:'Hello',startTime:start,duration:500,trackNumber:3},assEvent:{Start:start,Duration:500,Style:7,Text:'Hello'},isTranslating:true});
 assert.equal(sent.length,1);m.processEventTranslationQueue('Hello','مرحبا');
 assert.equal(rendered.length,3);assert.deepEqual(rendered.map(x=>x.Start),[100,1000,9000]);assert.ok(rendered.every(x=>x.Text==='مرحبا'&&x.Style===7));m.eventTranslationScheduler.clear();
});
