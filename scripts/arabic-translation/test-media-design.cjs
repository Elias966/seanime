const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../../seanime-web/public/media-hub.js'),'utf8');
class Node {
 constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.children=[];this.attributes={};this.dataset={};this.style={};}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 prepend(...nodes){for(const n of nodes)n.parent=this;this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attributes[k]=String(v);}
 getAttribute(k){return this.attributes[k];}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 focus(){this.focused=true;}
 querySelector(selector){const match=n=>selector[0]==='#'?n.id===selector.slice(1):selector.startsWith('[data-count=')?n.dataset.count===selector.match(/"(.*?)"/)[1]:n.tagName===selector;for(const n of this.children){if(match(n))return n;const found=n.querySelector?.(selector);if(found)return found;}return null;}
}
function setup(view='discover'){
 const d={createElement:t=>new Node(t),createElementNS:(_,t)=>new Node(t),createTextNode:t=>new Node('#text',t)};
 const calls=[],state={kind:'movies',view,scroll:120},root=new Node('section');root.scrollTop=120;
 const ctx={d,state,root,calls,console,setTimeout,clearTimeout};
 const selected=code.slice(code.indexOf('const tabCounts='),code.indexOf('async function show(){'))+code.slice(code.indexOf('function cards(items){'),code.indexOf('function magnet('));
 vm.runInNewContext(`const doc=d;let body=doc.createElement('main'),nav,status=doc.createElement('p'),currentItem,renderId=0,pollTimer;const engine='engine';const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};const button=(text,fn,cls='mh-button')=>{const b=el('button',text,cls);b.onclick=fn;return b};const image=(url,alt)=>{const n=el('img');n.src=url;n.alt=alt;return n};const post=async(path,value)=>{calls.push({path,value});return {}};const message=v=>status.textContent=v;const show=()=>calls.push('show');const open=()=>{};const leave=()=>{};const waitForFiles=()=>{};const request=async()=>[];const animePlay=()=>{};const onlineMovies=item=>calls.push('online');const movieTorrents=(item,n)=>calls.push('torrent');${selected}\nnav=header();globalThis.ui={cards,detail,header,body,nav,get status(){return status}};`,ctx);
 return {...ctx,ui:ctx.ui};
}
const movie={id:1,title:'<img src=x onerror=alert(1)>',provider:'yts',poster:'https://example.test/poster.jpg',year:2026,rating:8.2,genres:['Drama'],description:'A movie synopsis',torrents:[]};
test('poster/title navigation and quick library actions are separate buttons',async()=>{
 const {ui,calls,root}=setup();ui.cards([movie]);const grid=ui.body.children[0],card=grid.children[0],art=card.children[0],main=art.children[0],quick=art.children[1];
 assert.equal(card.tagName,'article');assert.equal(main.tagName,'button');assert.equal(quick.tagName,'button');assert.equal(main.querySelector('button'),null);assert.equal(main.getAttribute('aria-label'),'Open '+movie.title);assert.equal(card.children[1].children[0].textContent,movie.title);
 await quick.onclick();assert.equal(calls.length,1);assert.equal(calls[0].path,'/media/library');assert.equal(calls[0].value.item.title,movie.title);assert.equal(root.scrollTop,120);assert.equal(quick.disabled,true);assert.match(ui.status.textContent,/Saved/);
});
test('library quick removal retains results and updates actual library count',async()=>{
 const {ui,calls,state}=setup('library');ui.cards([movie]);const grid=ui.body.children[0];await grid.children[0].children[0].children[1].onclick();assert.equal(grid.children.length,0);assert.equal(state.view,'library');assert.equal(calls[0].value.action,'remove');assert.equal(ui.nav.querySelector('[data-count="library"]').textContent,'0');assert.match(ui.status.textContent,/empty/);
});
test('detail defaults to torrent releases and switches playback mode accessibly',async()=>{
 const {ui,calls,state}=setup();await ui.detail(movie);const group=ui.body.children.find(n=>n.className==='mh-watch-tabs');assert.deepEqual(calls,['torrent']);assert.equal(group.children[1].getAttribute('aria-pressed'),'true');assert.equal(ui.body.querySelector('h1').focused,true);await group.children[0].onclick();assert.equal(group.children[0].getAttribute('aria-pressed'),'true');assert.equal(group.children[1].getAttribute('aria-pressed'),'false');assert.equal(calls.at(-1),'online');assert.equal(state.scroll,120);
});
test('section navigation exposes current page and preserves existing navigation keys',()=>{
 const {ui,state,calls}=setup();const nav=ui.nav.children[1];assert.equal(nav.children[0].getAttribute('aria-current'),'page');nav.children[3].onclick();assert.equal(state.view,'sources');assert.deepEqual(calls,['show']);
});
