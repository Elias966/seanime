const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const mod={exports:{}};new Function('module',fs.readFileSync(__dirname+'/../../seanime-web/public/cover-picker.js','utf8'))(mod);const factory=mod.exports;
const version='a'.repeat(64),original='https://s4.anilist.co/cover.jpg';
function setup(saved){const events={},storage=new Map([['seanime.cover-choices.v1',JSON.stringify(saved)]]);const win={
 localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},Event:class{constructor(type){this.type=type}},dispatchEvent:e=>events[e.type]?.(e),addEventListener:(type,fn)=>events[type]=fn,
 document:{createElement:()=>({}),head:{append(){}},documentElement:{},querySelectorAll:()=>[]},MutationObserver:class{observe(){}},fetch:async()=>{throw Error('Offline')},requestAnimationFrame:()=>{}};
 return {api:factory(win),events,storage};}
test('saved cover resolves immediately while offline, including every original artwork size',async()=>{
 const t=setup({'123':{version,originals:[original,original+'?small']}});
 assert.equal(t.api.resolve(original),'http://127.0.0.1:11435/covers/image?id=123&v='+version);
 assert.equal(t.api.resolve(original+'?small'),t.api.resolve(original));assert.equal(t.api.resolve('https://s4.anilist.co/another.jpg'),undefined);
 await new Promise(setImmediate);assert.ok(t.api.resolve(original));
});
test('reset and changes propagate between windows and the entry button opens the same picker',()=>{
 const t=setup({'123':{version,originals:[original]}});t.events.storage({key:'seanime.cover-choices.v1',newValue:'{}'});assert.equal(t.api.resolve(original),undefined);
 const b=t.api.button({jsx:(tag,props)=>({tag,props})});assert.equal(b.tag,'button');assert.equal(b.props.children,'Change cover');assert.equal(typeof b.props.onClick,'function');
});
test('malformed persisted entries cannot turn cover URLs into arbitrary requests',()=>{
 const t=setup({'../123':{version,originals:[original]},'124':{version:'https://evil.example',originals:[original]}});assert.equal(t.api.resolve(original),undefined);
});
