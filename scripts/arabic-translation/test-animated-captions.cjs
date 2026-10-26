const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const mod={exports:{}};new Function('module',fs.readFileSync(__dirname+'/../../seanime-web/public/subtitle-translation-queue.js','utf8'))(mod);
const {normalizeAnimations,createQueue}=mod.exports;
function fragments(){return 'Hello world'.split('').flatMap((char,i)=>char===' '?[]:[{style:'OP',start:1000+i*20,end:3000,text:`{\\an5\\pos(${100+i*20},50)\\move(0,0,1,1)}${char}`,width:900}]);}
test('letter animations become a timed whole caption, not separate Arabic words at glyph positions',()=>{
 const input=fragments(),out=normalizeAnimations(input),phrases=out.filter(e=>e.normalized);
 assert.equal(phrases.length,1);assert.ok(phrases[0].text.endsWith('Hello world'));assert.match(phrases[0].text,/\\pos\(450,50\)/);assert.equal(phrases[0].start,1000);assert.equal(phrases[0].end,3000);
 assert.equal(out.filter(e=>!e.text).length,9);assert.notEqual(input[0].text,out[0].text);
});
test('ordinary positioned signs and dialogue retain their own timing and styles',()=>{
 const records=[{style:'Sign',start:1,end:2,text:'{\\pos(20,40)\\fs12}Shop'},{style:'Default',start:3,end:4,text:'Hello there'}];assert.deepEqual(normalizeAnimations(records),records);
});
test('repeated FX shadows contribute a word once and simultaneous phrases use separate rows',()=>{
 const records=[];for(const style of ['OP1','OP2'])for(let i=0;i<9;i++){
  records.push({style,start:1000+i*20,end:3000,text:`{\\pos(${100+i*20},50)\\move(0,0,1,1)}ab`});
  for(let shadow=0;shadow<3;shadow++)records.push({style,start:1750+i*20,end:3500,text:`{\\move(${100+i*20},50,0,0)\\blur${shadow}}${['We','can','read','the','whole','line','in','our','language'][i]}`});
 }
 const out=normalizeAnimations(records).filter(x=>x.normalized);assert.equal(out.length,2);assert.ok(out.every(x=>x.text.endsWith('We can read the whole line in our language')));assert.match(out[0].text,/\\pos\(960,50\)/);assert.match(out[1].text,/\\pos\(960,150\)/);
});
test('queue buffers fragments, translates the complete phrase, delivers new timing and cancels on destruction',()=>{
 let timer;const sent=[],out=[],progress=[];const q=createQueue({send:x=>sent.push(x),apply:(item,text,layout)=>out.push({item,text,layout}),setTimeout:fn=>(timer=fn,1),clearTimeout(){},onProgress:p=>progress.push(p)});
 const input=fragments();for(const e of input)q.enqueueFormatted(e.text,{assEvent:{Text:e.text,Start:e.start,Duration:e.end-e.start,Style:e.style}});
 assert.equal(sent.length,0);assert.equal(progress.at(-1).pending,10);timer();assert.deepEqual(sent,['Hello world']);q.accept('Hello world','مرحبا بالعالم');
 assert.equal(out.length,10);const phrase=out.find(x=>x.text);assert.ok(phrase.text.endsWith('مرحبا بالعالم'));assert.deepEqual(phrase.layout,{Start:1000,Duration:2000});q.clear();
 const dead=createQueue({send:()=>{throw Error('destroyed')},apply:()=>{throw Error('destroyed')},setTimeout:fn=>(timer=fn,1),clearTimeout(){}});dead.enqueueFormatted(input[0].text,{assEvent:{Start:1,Duration:1,Style:1}});dead.clear();timer();
});
test('smart quotes in animated words are normalized along with ASCII letters',()=>{
 const input=fragments();input.push({style:'OP',start:1500,end:3000,text:'{\\pos(330,50)\\move(0,0,1,1)}“we”'});
 const out=normalizeAnimations(input);assert.equal(out.filter(e=>e.text&&!e.normalized).length,0);
});
test('a complete English lyric replaces the matching romanization instead of adding phonetic Arabic',()=>{
 const input=fragments().map(e=>({...e,style:'ED1-Rom'}));input.push({style:'ED1-Eng',effect:'fx',start:1000,end:4000,text:'{\\pos(450,400)}Tomorrow'});
 const out=normalizeAnimations(input);assert.ok(out.slice(0,10).every(e=>!e.text));assert.equal(out[10].text,input[10].text);
});
test('shipped manager applies normalized phrase timing, resolution and Arabic through the real queue adapter',{skip:!process.env.SEANIME_PLAYER_BUNDLE},()=>{
 const vm=require('node:vm'),raw=fs.readFileSync(process.env.SEANIME_PLAYER_BUNDLE,'utf8'),a=raw.indexOf('_queueEventTranslation(e){'),b=raw.indexOf('_getTracks(){',a);let flush;
 const ctx={window:{SeanimeCreateSubtitleTranslationQueue:options=>createQueue({...options,setTimeout:(fn,ms)=>{if(ms===1000)flush=fn;return 1},clearTimeout(){}})}};vm.createContext(ctx);
 const M=vm.runInContext('(class{'+raw.slice(a,b)+'})',ctx),m=new M(),sent=[],rendered=[];
 Object.assign(m,{videoElement:{currentTime:1},currentTrackNumber:3,eventTracks:{3:{info:{codecPrivate:'PlayResX: 900'}}},sendTranslateRequest:text=>sent.push(text),libassRenderer:{renderer:{createEvent:e=>rendered.push(e)}}});
 for(const e of fragments())m._queueEventTranslation({event:{trackNumber:3,startTime:e.start,duration:e.end-e.start,extraData:{style:'OP'}},assEvent:{Start:e.start,Duration:e.end-e.start,Style:1,Text:e.text}});
 flush();assert.deepEqual(sent,['Hello world']);m.processEventTranslationQueue('Hello world','مرحبا بالعالم');const phrase=rendered.find(e=>e.Text);assert.match(phrase.Text,/\\pos\(450,50\)/);assert.ok(phrase.Text.endsWith('مرحبا بالعالم'));assert.equal(phrase.Start,1000);assert.equal(phrase.Duration,2000);m.eventTranslationScheduler.clear();
});
test('a short lowercase lyric continuation is translated with its sentence subject',()=>{
 const records=[];for(const [line,start,end]of [['We can read',1000,3000],['our subtitles',3200,6000]])for(const [i,char]of [...line].entries())if(char!==' ')records.push({style:'OP',start:start+i*20,end,text:`{\\pos(${100+i*20},50)\\move(0,0,1,1)}${char}`,width:900});
 const out=normalizeAnimations(records).filter(e=>e.normalized);assert.equal(out.length,1);assert.ok(out[0].text.endsWith('We can read our subtitles'));assert.equal(out[0].end,6000);
});
