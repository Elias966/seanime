const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const mod={exports:{}};new Function('module',fs.readFileSync(__dirname+'/../../seanime-web/public/entry-navigation.js','utf8'))(mod);
function setup(initial='/search?genre=Action'){
 const events={},docEvents={},frames=[],storage=new Map(),stack=[{href:initial,state:{__TSR_key:'search-a'}}];let index=0,searchMounted=true,mutation;
 const win={scrollX:0,scrollY:1600,location:{pathname:'/search',search:'?genre=Action',assign:href=>win.assigned=href},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
 document:{head:{append(){}},createElement:()=>({}),documentElement:{},addEventListener:(t,fn)=>docEvents[t]=fn,querySelector:()=>searchMounted?{}:null,querySelectorAll:()=>[]},
 addEventListener:(t,fn)=>events[t]=fn,requestAnimationFrame:fn=>(frames.push(fn),frames.length),cancelAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},scrollTo:p=>{win.scrollX=p.left;win.scrollY=p.top},
 MutationObserver:class{constructor(fn){mutation=fn}observe(){}},ResizeObserver:class{observe(){}},history:{get state(){return stack[index].state},pushState(state,_,url){stack.splice(++index);stack.push({state,href:url});setLocation(url)},replaceState(state,_,url){stack[index]={state,href:url};setLocation(url)},back(){if(index){setLocation(stack[--index].href);events.popstate()}}}};
 function setLocation(href){const [p,q='']=href.split('?');win.location.pathname=p;win.location.search=q?'?'+q:'';win.scrollY=0}
 const api=mod.exports(win);return{win,api,events,frames,flush(){while(frames.length)frames.shift()()},mount(value){searchMounted=value;mutation()},docEvents,storage};
}
test('back restores the selected genres and scroll of the actual search visit',()=>{
 const t=setup();t.api.setSearchParams({genre:['Comedy','Fantasy'],title:'dragon',type:'anime'});t.events.scroll();t.win.history.pushState({__TSR_key:'entry-a'},'', '/entry?id=42');
 t.win.scrollY=800;t.events.scroll();t.api.back();t.flush();assert.equal(t.win.scrollY,1600);assert.deepEqual(t.api.restoreSearch(),{genre:['Comedy','Fantasy'],title:'dragon',type:'anime'});
});
test('restoration waits for search results to mount and responds to their layout changes',()=>{
 const t=setup();t.api.setSearchParams({genre:['Action']});t.events.scroll();t.win.history.pushState({__TSR_key:'entry-b'},'', '/entry?id=1');t.mount(false);t.api.back();t.flush();assert.equal(t.win.scrollY,0);t.mount(true);t.flush();assert.equal(t.win.scrollY,1600);
});
test('manual scrolling cancels restoration and separate history visits keep separate filters',()=>{
 const t=setup();t.api.setSearchParams({genre:['Action']});t.events.scroll();t.win.history.pushState({__TSR_key:'entry-c'},'', '/entry?id=1');t.api.back();t.events.wheel({});t.flush();assert.equal(t.win.scrollY,0);assert.deepEqual(t.api.restoreSearch().genre,['Action']);
 t.win.history.pushState({__TSR_key:'search-b'},'', '/search?genre=Drama');t.api.setSearchParams({genre:['Drama']});t.win.scrollY=2500;t.events.scroll();t.win.history.pushState({__TSR_key:'entry-d'},'', '/entry?id=2');t.api.back();t.flush();assert.equal(t.win.scrollY,2500);assert.deepEqual(t.api.restoreSearch().genre,['Drama']);
});
test('directly opened entries have a safe internal search fallback',()=>{
 const t=setup('/entry?id=1');t.win.location.pathname='/entry';t.win.location.search='?id=1';let rendered,navigated;t.api.connectRouter({subscribe:(_,fn)=>rendered=fn,navigate:options=>navigated=options});rendered();t.api.back();assert.deepEqual(navigated,{to:'/search'});
});
test('compiled search retains pages and restores the snapshot before applying URL genre defaults',{skip:!process.env.SEANIME_SEARCH_BUNDLE},()=>{
 const code=fs.readFileSync(process.env.SEANIME_SEARCH_BUNDLE,'utf8');assert.equal((code.match(/refetchOnMount:!1,gcTime:864e5/g)||[]).length,2);assert.ok(code.includes('window.SeanimeNavigation?.setSearchParams(A)'));assert.ok(code.includes('if(saved){L(saved);return}'));
});
test('hover preview links save the stable result card position instead of the popup offset',()=>{
 const t=setup();t.api.setSearchParams({genre:['Comedy']});const card={getBoundingClientRect:()=>({top:1920-t.win.scrollY})};
 const oldQuery=t.win.document.querySelector;t.win.document.querySelector=selector=>selector.includes('data-media-id')?card:oldQuery(selector);
 const link={getAttribute:()=>'/entry?id=42',getBoundingClientRect:()=>({top:100})};
 t.docEvents.click({target:{closest:()=>link},button:0});t.win.history.pushState({__TSR_key:'entry-hover'},'', '/entry?id=42');t.api.back();t.flush();assert.equal(t.win.scrollY,1600);
});
