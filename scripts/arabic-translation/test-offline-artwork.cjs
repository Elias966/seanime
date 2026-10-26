const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const m={exports:{}};new Function('module',fs.readFileSync(__dirname+'/../../seanime-web/public/offline-artwork.js','utf8'))(m);
const {resolve,collect}=m.exports;
test('known covers and episode thumbnails use the same persistent URL online and offline',()=>{
 for(const url of ['https://s4.anilist.co/file/cover.jpg','https://artworks.thetvdb.com/banners/episode.jpg','https://image.tmdb.org/t/p/original/frame.webp'])assert.equal(resolve(url),'http://127.0.0.1:11435/images?url='+encodeURIComponent(url));
});
test('local offline placeholders resolve and unrelated or unsupported URLs stay unchanged',()=>{
 assert.equal(resolve('{{LOCAL_ASSETS}}/12/cover.jpg'),'http://127.0.0.1:43211/offline-assets/12/cover.jpg');
 for(const url of ['/no-cover.png','data:image/png;base64,abc','https://example.com/image.png','http://127.0.0.1:43211/assets/test.jpg','https://s4.anilist.co.evil.example/a'])assert.equal(resolve(url),url);
});
test('background warm-up collects covers and unseen episode thumbnails without duplicate requests',()=>{
 const cover='https://s4.anilist.co/cover.jpg',thumb='https://artworks.thetvdb.com/episode.jpg';
 assert.deepEqual([...collect({coverImage:{large:cover,medium:cover},episodes:[{image:thumb},{image:thumb}],website:'https://anilist.co/anime/12'})],[cover,thumb]);
});
test('shipped shared Image component routes artwork through disk cache and retries after warming',{skip:!process.env.SEANIME_BOOTSTRAP},()=>{
 const raw=fs.readFileSync(process.env.SEANIME_BOOTSTRAP,'utf8'),start=raw.indexOf('76766(t,a,n){'),end=raw.indexOf(',n.d(a,{},{r:s})}',start);
 assert.ok(start>=0&&end>start);const effects=[],listeners=[];
 const window={SeanimeResolveImageUrl:resolve,addEventListener:name=>listeners.push(name),removeEventListener:()=>{}};
 const react={forwardRef:fn=>fn,useState:()=>[false,()=>{}],useEffect:fn=>effects.push(fn)};
 const requireModule=id=>id===68413?react:id===97145?{c:size=>Array(size).fill(Symbol.for('react.memo_cache_sentinel'))}:{jsx:(type,props)=>typeof type==='function'?type(props,null):{type,props}};
 const api=new Function('n','window',raw.slice(start+'76766(t,a,n){'.length,end)+';return {SeaImage:s,Image:l}')(requireModule,window);
 const url='https://s4.anilist.co/cover.jpg';const image=api.SeaImage({src:url,alt:'Local cover',width:120,className:'cover'},null);
 assert.equal(image.type,'img');assert.equal(image.props.src,resolve(url));assert.equal(image.props.alt,'Local cover');assert.equal(image.props.width,120);assert.equal(image.props.className,'cover');
 effects[0]();assert.deepEqual(listeners,['online','seanime:artwork-ready']);
 assert.equal(api.Image({src:url,overrideSrc:'/no-cover.png',alt:''},null).props.src,'/no-cover.png');
});
