const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../../seanime-web/public/media-hub.js'),'utf8'),registry=require('../media-hub/sources.json');
class Element{
 constructor(tag,text=''){this.tag=tag;this.textContent=text;this.children=[];this.value='';this.attrs={}}
 append(...nodes){this.children.push(...nodes);if(this.tag==='select')for(const n of nodes){if(n.selected||!this.value)this.value=n.value}}
 setAttribute(k,v){this.attrs[k]=v}
}
function setup(disabled=[]){
 const db={disabledSourceIds:[...disabled]},opened=[],requests=[],forms=[],state={kind:'movies',provider:'yts',view:'discover',q:'test',page:3},root={hidden:false};
 const ctx={state,root,Promise,el:(tag,text)=>new Element(tag,text),uiIcon:()=>new Element('svg'),body:{append:n=>forms.push(n)},button:(text,fn)=>Object.assign(new Element('button',text),{onclick:fn}),show:async()=>{},openSourceBrowser:s=>opened.push(s.id),request:async url=>{requests.push(url);return url==='/media/source-registry'?registry:{disabledSourceIds:[...db.disabledSourceIds]}},post:async(url,v)=>{assert.equal(url,'/media/source-preferences');db.disabledSourceIds=db.disabledSourceIds.filter(x=>x!==v.id);if(!v.enabled)db.disabledSourceIds.push(v.id);return {disabledSourceIds:[...db.disabledSourceIds]}}};
 vm.runInNewContext(code.slice(code.indexOf('let registryPromise,'),code.indexOf('function nativePlayerState('))+code.slice(code.indexOf('function filters('),code.indexOf('async function catalog('))+'globalThis.api={discoverSources,setSourceEnabled,sourceKey,sourceEnabled,filters}',ctx);return {...ctx,db,opened,requests,forms};
}
test('Discover includes every available movie and anime source from the shared registry',async()=>{
 const c=setup();for(const kind of ['movies','anime']){const choices=await c.api.discoverSources(kind),expected=registry.sources.filter(x=>x.kinds.includes(kind)&&x.mode!=='unavailable');assert.equal(choices.length,expected.length);assert.deepEqual(new Set(choices.map(x=>x.id)),new Set(expected.map(x=>x.id)))}
 const choices=await c.api.discoverSources('movies');c.api.filters(choices);const select=c.forms[0].children.find(x=>x.attrs['aria-label']==='Catalog source');assert.equal(select.children.length,45);assert.ok(select.children.some(x=>x.textContent==='1Shows · Website'));assert.ok(select.children.some(x=>x.textContent==='Asiaflix · Website'));
});
test('disable hides native and website sources, falls back from disabled selection, and reenables correctly',async()=>{
 const c=setup(),yts=registry.sources.find(x=>x.id==='yts'),site=registry.sources.find(x=>x.id==='1shows');await c.api.discoverSources('movies');await c.api.setSourceEnabled(yts,false);await c.api.setSourceEnabled(site,false);assert.notEqual(c.state.provider,'yts');let choices=await c.api.discoverSources('movies');assert.ok(!choices.some(x=>['yts','1shows'].includes(x.id)));assert.equal(choices.length,43);const restarted=setup(c.db.disabledSourceIds);assert.equal((await restarted.api.discoverSources('movies')).length,43);await c.api.setSourceEnabled(site,true);assert.ok((await c.api.discoverSources('movies')).some(x=>x.id==='1shows'));assert.ok(!(await c.api.discoverSources('movies')).some(x=>x.id==='yts'));
});
test('selecting a website in Discover opens that source, without pretending to fetch a catalog',async()=>{
 const c=setup(),choices=await c.api.discoverSources('movies');c.api.filters(choices);const select=c.forms[0].children.find(x=>x.attrs['aria-label']==='Catalog source');select.value='site:1shows';await select.onchange();assert.equal(c.state.provider,'site:1shows');assert.deepEqual(c.opened,['1shows']);assert.ok(c.requests.every(x=>['/media/source-registry','/media/source-preferences'].includes(x)));
});
test('all sources disabled produces no hidden fallback to a disabled catalog',async()=>{
 const c=setup(registry.sources.map(x=>x.id));assert.equal((await c.api.discoverSources('movies')).length,0);c.api.filters([]);const select=c.forms[0].children.find(x=>x.attrs['aria-label']==='Catalog source');assert.equal(select.disabled,true);assert.equal(select.children[0].textContent,'No enabled sources');
});
