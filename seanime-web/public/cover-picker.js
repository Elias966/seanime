/* Per-anime cover gallery and persistent offline overrides. GPL-3.0. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.SeanimeCovers=factory(root)})(typeof window==='object'?window:globalThis,function(win){
    'use strict';
    const base='http://127.0.0.1:11435',key='seanime.cover-choices.v1';let choices={},aliases=new Map(),dialog;
    function set(value){choices=value||{};aliases=new Map();for(const[id,item]of Object.entries(choices))if(/^\d+$/.test(id)&&/^[a-f0-9]{64}$/.test(item.version||''))for(const url of item.originals||[])aliases.set(url,base+'/covers/image?id='+id+'&v='+item.version);try{win.localStorage.setItem(key,JSON.stringify(choices))}catch{}win.dispatchEvent(new win.Event('seanime:covers-changed'))}
    try{set(JSON.parse(win.localStorage.getItem(key)||'{}'))}catch{}
    const resolve=url=>aliases.get(url);
    async function json(url,options){const response=await win.fetch(url,{...options,signal:AbortSignal.timeout(25000)});let value;try{value=await response.json()}catch{}if(!response.ok)throw Error(value?.error||'Cover service unavailable');return value}
    function unproxy(url){try{const u=new URL(url);return u.pathname==='/images'?u.searchParams.get('url'):url}catch{return url}}
    function originals(media,card){const urls=[...Object.values(media.coverImage||{}),media.bannerImage,...(choices[String(media.id)]?.originals||[])];if(card)for(const image of card.querySelectorAll('img'))urls.push(unproxy(image.getAttribute('src')));return [...new Set(urls.filter(url=>typeof url==='string'&&/^https:\/\//.test(url)))].slice(0,8)}
    const imageUrl=url=>base+'/images?url='+encodeURIComponent(url);
    function element(tag,text,className){const node=win.document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node}
    async function open(id,card){
        if(dialog?.open)return;const entry=win.document.querySelector('[data-anime-entry-page]');let media;
        try{const value=JSON.parse(entry?.getAttribute('data-media')||'null');if(String(value?.id)===String(id)||!id)media=value}catch{}
        id=String(id||media?.id||'');if(!/^\d+$/.test(id))return;
        media=media||{id:Number(id),idMal:Number(card?.getAttribute('data-media-mal-id'))||undefined,title:{userPreferred:choices[id]?.title||card?.textContent?.trim().slice(0,120)||'Anime'}};
        const currentDialog=dialog=element('dialog',null,'seanime-cover-dialog');const panel=element('div',null,'seanime-cover-panel'),header=element('div',null,'seanime-cover-header'),heading=element('h2','Change cover'),close=element('button','×','seanime-cover-close');close.type='button';close.setAttribute('aria-label','Close cover picker');
        const labelId='seanime-cover-title';heading.id=labelId;currentDialog.setAttribute('aria-labelledby',labelId);close.onclick=()=>currentDialog.close();header.append(heading,close);
        const subtitle=element('p','Loading artwork…','seanime-cover-subtitle'),status=element('p','Loading alternative covers…','seanime-cover-status'),grid=element('div',null,'seanime-cover-grid');panel.append(header,subtitle,status,grid);currentDialog.append(panel);win.document.body.append(currentDialog);currentDialog.addEventListener('close',()=>currentDialog.remove(),{once:true});currentDialog.addEventListener('click',e=>{if(e.target===currentDialog)currentDialog.close()});currentDialog.showModal();
        let info=media;
        if(!media.coverImage)try{const result=await json('http://127.0.0.1:43211/api/v1/library/anime-entry/'+id);if(result.data?.media)info=result.data.media}catch{}
        if(!currentDialog.isConnected)return;
        const title=info.title?.userPreferred||info.title?.romaji||info.title?.english||media.title.userPreferred;
        subtitle.textContent=title;const urls=originals(info,card),malId=info.idMal||media.idMal;
        let saving=false;
        async function choose(kind,source){
            if(saving)return;saving=true;status.textContent='Saving cover…';for(const b of grid.querySelectorAll('button'))b.disabled=true;
            try{const result=await json(base+'/covers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,malId,kind,source,title,originals:urls})});set(result);currentDialog.close()}
            catch(error){status.textContent=error.message;saving=false;for(const b of grid.querySelectorAll('button'))b.disabled=false}
        }
        function option(label,kind,source,preview){const button=element('button',null,'seanime-cover-option');button.type='button';button.setAttribute('aria-label',label);const selected=kind==='original'?!choices[id]:choices[id]?.kind===kind&&(kind!=='image'||choices[id]?.source===source);button.setAttribute('aria-pressed',String(selected));
            if(preview){const img=element('img');img.src=preview;img.alt=label;img.loading='lazy';img.onerror=()=>{img.hidden=true;button.classList.add('seanime-cover-image-missing')};button.append(img)}else{const neutral=element('div',title,'seanime-cover-neutral');button.append(neutral)}button.append(element('span',label));button.onclick=()=>choose(kind,source);grid.append(button)}
        option('Original cover','original',null,urls[0]?imageUrl(urls[0]):null);option('Title-only cover','neutral');
        if(!malId){status.textContent='Alternative artwork is unavailable for this anime. You can use its original or title-only cover.';return}
        try{const result=await json(base+'/covers/options?malId='+malId);if(!currentDialog.isConnected)return;const images=(result.images||[]).filter(url=>!urls.includes(url));images.forEach((url,i)=>option('Alternative cover '+(i+1),'image',url,imageUrl(url)));status.textContent=images.length?'Choose a cover. Alternatives are from MyAnimeList.':'No additional posters were found. You can use its original or title-only cover.'}
        catch(error){if(currentDialog.isConnected)status.textContent=error.message}
    }
    function button(jsx){return jsx.jsx('button',{type:'button','data-change-anime-cover':true,title:'Choose a different cover',onClick:()=>open(),children:'Change cover'})}
    function scan(){for(const card of win.document.querySelectorAll('[data-media-id][data-media-type="anime"]')){
        if(card.querySelector(':scope > [data-cover-picker-card]'))continue;const b=element('button','▧','seanime-cover-card-button');b.type='button';b.setAttribute('data-cover-picker-card','');b.setAttribute('aria-label','Change anime cover');b.title='Change cover';b.onclick=e=>{e.preventDefault();e.stopPropagation();open(card.getAttribute('data-media-id'),card)};card.append(b);
    }}
    const style=element('style');style.textContent=`[data-entry-back-navigation]{display:flex;align-items:center;gap:8px}[data-change-anime-cover]{border:1px solid #ffffff20;border-radius:10px;padding:8px 12px;background:#202026;color:#eee;cursor:pointer}.seanime-cover-card-button{position:absolute;right:7px;top:7px;z-index:80;width:30px;height:30px;border:1px solid #ffffff30;border-radius:8px;background:#161622ed;color:#fff;cursor:pointer;opacity:0}[data-media-id]:hover>.seanime-cover-card-button,.seanime-cover-card-button:focus-visible{opacity:1}.seanime-cover-dialog{padding:0;border:1px solid #ffffff25;border-radius:16px;background:#13131a;color:#eee;width:min(900px,94vw);max-height:90vh;box-shadow:0 16px 80px #000b}.seanime-cover-dialog::backdrop{background:#000b}.seanime-cover-panel{padding:24px}.seanime-cover-header{display:flex;justify-content:space-between;align-items:center}.seanime-cover-header h2{font-size:23px;font-weight:650;margin:0}.seanime-cover-close{font-size:28px;background:none;border:0;color:#ccc;cursor:pointer;padding:0 8px}.seanime-cover-subtitle{color:#b7b7c8;margin:6px 0 14px}.seanime-cover-status{font-size:13px;color:#bfc2de;margin:8px 0 16px;min-height:20px}.seanime-cover-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:14px}.seanime-cover-option{position:relative;display:flex;flex-direction:column;padding:5px;border:2px solid #ffffff18;border-radius:10px;background:#20202b;color:#eee;cursor:pointer;text-align:center;overflow:hidden}.seanime-cover-option:hover{border-color:#818cf8}.seanime-cover-option[aria-pressed=true]{border-color:#a5b4fc}.seanime-cover-option:focus-visible{outline:2px solid #a5b4fc;outline-offset:3px}.seanime-cover-option:disabled{opacity:.6;cursor:wait}.seanime-cover-option img,.seanime-cover-neutral{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:5px}.seanime-cover-neutral{background:#191b2b;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;overflow-wrap:anywhere;font-size:17px;color:#eef0ff}.seanime-cover-option span{padding:8px 1px;font-size:12px}.seanime-cover-image-missing{min-height:180px}@media(hover:none){.seanime-cover-card-button{opacity:1}}`;
    win.document.head.append(style);
    let queued=false;const observer=new win.MutationObserver(()=>{if(!queued){queued=true;win.requestAnimationFrame(()=>{queued=false;scan()})}});observer.observe(win.document.documentElement,{childList:true,subtree:true});scan();
    win.addEventListener('storage',event=>{if(event.key===key)try{set(JSON.parse(event.newValue||'{}'))}catch{}});
    json(base+'/covers').then(set).catch(()=>{});
    return {resolve,open,button};
});
