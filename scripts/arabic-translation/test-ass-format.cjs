const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const queueModule={exports:{}};new Function('module',fs.readFileSync(__dirname+'/../../seanime-web/public/subtitle-translation-queue.js','utf8'))(queueModule);
const {createQueue,createAssPlan}=queueModule.exports;
const source='{\\an7\\pos(130,180)\\fs18\\frz12\\c&H00FF00&}Blacksmith\\N{\\fs12\\b1}Legendary{\\rSign} class';
test('translation never sees ASS, and sizes, placement, color, rotation, resets and hard breaks remain',()=>{
 const p=createAssPlan(source);assert.deepEqual(p.runs.map(x=>x.source),['Blacksmith','Legendary','class']);
 assert.equal(p.render(['حداد','أسطوري','فئة']),'{\\an7\\pos(130,180)\\fs18\\frz12\\c&H00FF00&}حداد\\N{\\fs12\\b1}أسطوري{\\rSign} فئة');
});
test('drawing coordinates are untouched; drawing-off resumes translatable dialogue',()=>{
 const p=createAssPlan('{\\p1\\pos(1,2)}m 0 0 l 10 10{\\p0}Hello');assert.deepEqual(p.runs.map(x=>x.source),['Hello']);
 assert.equal(p.render(['مرحبا']),'{\\p1\\pos(1,2)}m 0 0 l 10 10{\\p0}مرحبا');
});
test('duplicate plain text keeps different style per occurrence, even with cached responses',()=>{
 const sent=[],out=[],q=createQueue({send:x=>sent.push(x),apply:(item,text)=>out.push({item,text})});
 q.enqueueFormatted('{\\fs12\\pos(30,40)}Hello',{id:1});q.enqueueFormatted('{\\fs48\\an8}Hello',{id:2});
 assert.deepEqual(sent,['Hello']);q.accept('Hello','مرحبا');q.enqueueFormatted('{\\b1}Hello',{id:3});
 assert.deepEqual(out.map(x=>x.text),['{\\fs12\\pos(30,40)}مرحبا','{\\fs48\\an8}مرحبا','{\\b1}مرحبا']);q.clear();
});
test('formatting-only/drawing events make no model request and malformed model overrides cannot execute',()=>{
 const sent=[],out=[],q=createQueue({send:x=>sent.push(x),apply:(_,text)=>out.push(text)});
 q.enqueueFormatted('{\\p1}m 0 0 l 1 1',{});assert.equal(sent.length,0);
 q.enqueueFormatted('{\\fs14}Hello',{});q.accept('Hello','ext{مرحبا}');
 assert.deepEqual(out,['{\\p1}m 0 0 l 1 1','{\\fs14}Hello']);q.clear();
});
const ass='[Script Info]\r\nPlayResX: 900\r\n[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize\r\nStyle: Sign,Roboto,12\r\n[Events]\r\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\nComment: 0,0:00:00.00,0:00:10.00,Sign,,0,0,0,,Do not translate\r\nDialogue: 4,0:00:01.00,0:00:10.00,Sign,Actor,12,13,14,banner,'+source+'\r\n';
test('whole ASS file retains headers, comments, CRLF and every non-Text event field byte for byte',()=>{
 const sent=[];let result;const q=createQueue({send:x=>sent.push(x),getStart:()=>{throw Error('file uses its own time')},apply:()=>{throw Error('file has its own receiver')}});
 q.enqueueAss(ass,text=>result=text);assert.deepEqual(sent,['Blacksmith','Legendary','class']);
 q.accept('Blacksmith','حداد');q.accept('Legendary','أسطوري');assert.equal(result,undefined);q.accept('class','فئة');
 assert.equal(result,ass.replace(source,createAssPlan(source).render(['حداد','أسطوري','فئة'])));q.clear();
});
test('destroy prevents late whole-file selection',()=>{
 let called=false;const q=createQueue({send:()=>{},apply:()=>{}});q.enqueueAss(ass,()=>called=true);q.clear();
 assert.equal(q.accept('Blacksmith','حداد'),false);assert.equal(called,false);
});
test('actual compiled adapter preserves ASS and creates a separate styled file track',{skip:!process.env.SEANIME_PLAYER_BUNDLE},()=>{
 const raw=fs.readFileSync(process.env.SEANIME_PLAYER_BUNDLE,'utf8'),a=raw.indexOf('_queueEventTranslation(e){'),b=raw.indexOf('_getTracks(){',a);
 const ctx={window:{SeanimeCreateSubtitleTranslationQueue:createQueue}};vm.createContext(ctx);
 const Manager=vm.runInContext('(class{'+raw.slice(a,b)+'})',ctx),m=new Manager(),sent=[],rendered=[],added=[];
 Object.assign(m,{videoElement:{currentTime:1},currentTrackNumber:3,shouldTranslate:'ar',sendTranslateRequest:text=>sent.push(text),libassRenderer:{renderer:{createEvent:event=>rendered.push(event)}},translatedFileTracks:new Map([[3,{translating:true}]]),fileTracks:{3:{info:{index:3,label:'English',language:'en'},content:ass}},addFileTrack:track=>added.push(track)});
 m._queueEventTranslation({event:{startTime:0,duration:1000,trackNumber:3},assEvent:{Text:'{\\fs18\\pos(10,20)}Hello',Style:7}});
 assert.equal(sent[0],'Hello');m.processEventTranslationQueue('Hello','مرحبا');assert.equal(rendered[0].Text,'{\\fs18\\pos(10,20)}مرحبا');
 m._queueFileTranslation(3);for(const [s,t]of [['Blacksmith','حداد'],['Legendary','أسطوري'],['class','فئة']])m.processEventTranslationQueue(s,t);
 assert.equal(added.length,1);assert.equal(added[0].type,'ass');assert.equal(added[0].language,'ar');assert.equal(added[0].content,ass.replace(source,createAssPlan(source).render(['حداد','أسطوري','فئة'])));assert.equal(m.fileTracks[3].content,ass);assert.equal(m.translatedFileTracks.get(4).translating,false);m.eventTranslationScheduler.clear();
});
test('compiled customization clears stale overrides for multi-style ASS files',{skip:!process.env.SEANIME_PLAYER_BUNDLE},async()=>{
 const raw=fs.readFileSync(process.env.SEANIME_PLAYER_BUNDLE,'utf8'),a=raw.indexOf('async _applySubtitleCustomization(){'),b=raw.indexOf('__eventMapKey(',a);
 const ctx={tI:{info(){}},tR:'Roboto'};vm.createContext(ctx);const M=vm.runInContext('(class{'+raw.slice(a,b)+'})',ctx),m=new M();let disabled=0;
 Object.assign(m,{settings:{subtitleCustomization:{enabled:true}},currentTrackNumber:2,eventTracks:{},fileTracks:{2:{content:'Style: Default,Roboto,30\nStyle: Sign,Roboto,12\n'}},libassRenderer:{ready:Promise.resolve(),renderer:{disableStyleOverride:()=>disabled++,styleOverride:()=>{throw Error('must not flatten styles')}}}});
 await m._applySubtitleCustomization();assert.equal(disabled,1);
});
