/* Entry back navigation and per-history-entry browsing state. GPL-3.0. */
(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory;
    else root.SeanimeNavigation=factory(root);
})(typeof window==='object'?window:globalThis,function(win){
    'use strict';
    const entries=new Map(), storage='seanime.browsing.v1';
    let router, liveParams=null, current, restoring=null, frame=0, timer=0, departure=null;
    const clone=value=>value==null?null:JSON.parse(JSON.stringify(value));
    const key=()=>win.history.state?.__TSR_key||win.history.state?.key||win.location.pathname+win.location.search;
    const href=()=>win.location.pathname+win.location.search;
    const search=()=>/^\/search\/?$/.test(win.location.pathname);
    try{for(const entry of JSON.parse(win.sessionStorage.getItem(storage)||'[]'))entries.set(...entry)}catch{}
    function persist(){try{win.sessionStorage.setItem(storage,JSON.stringify([...entries].slice(-80)))}catch{}}
    function cancel(){restoring=null;win.cancelAnimationFrame(frame);win.clearTimeout(timer)}
    function save(position){
        if(!current)return;
        const entry=entries.get(current.key)||{href:current.href};
        Object.assign(entry,{x:position?.x??win.scrollX,y:position?.y??win.scrollY});
        if(/^\/search\/?(?:\?|$)/.test(current.href)&&liveParams)entry.params=clone(liveParams);
        if(departure?.key===current.key)Object.assign(entry,departure.saved);
        entries.set(current.key,entry);persist();
    }
    function apply(){
        if(!restoring)return;
        if(key()!==restoring.key){cancel();return}
        if(search()&&!win.document.querySelector('[data-search-page-container]'))return;
        let y=restoring.y||0;
        if(restoring.anchor){
            const anchor=restoring.anchor.mediaId
                ? win.document.querySelector('[data-search-page-list] [data-media-id="'+restoring.anchor.mediaId+'"]')
                : [...win.document.querySelectorAll('a[href]')].find(a=>a.getAttribute('href')===restoring.anchor.href);
            if(anchor)y=win.scrollY+anchor.getBoundingClientRect().top-restoring.anchor.top;
        }
        win.scrollTo({left:restoring.x||0,top:Math.max(0,y),behavior:'instant'});
    }
    function schedule(){if(restoring){win.cancelAnimationFrame(frame);frame=win.requestAnimationFrame(apply)}}
    function changed(parent){
        cancel();const next=key(), entry=entries.get(next)||{href:href(),parent};
        entries.set(next,entry);current={key:next,href:href(),x:win.scrollX,y:win.scrollY};departure=null;
        if(entry.y!==undefined){restoring={...entry,key:next};timer=win.setTimeout(cancel,10000);schedule()}
        persist();
    }
    current={key:key(),href:href(),x:win.scrollX,y:win.scrollY};
    if(!entries.has(current.key))entries.set(current.key,{href:current.href});
    win.history.scrollRestoration='manual';
    for(const method of ['pushState','replaceState']){
        const original=win.history[method].bind(win.history);
        win.history[method]=function(...args){
            const before=current.key, beforeHref=href();
            save();const result=original(...args);
            if(key()!==before||href()!==beforeHref)changed(method==='pushState'?before:entries.get(before)?.parent);
            return result;
        };
    }
    win.addEventListener('scroll',()=>{if(current){current.x=win.scrollX;current.y=win.scrollY}}, {passive:true});
    win.addEventListener('popstate',()=>{save(current);changed()});
    win.addEventListener('pagehide',()=>save());
    win.document.addEventListener('click',event=>{
        const link=event.target.closest?.('a[href]');
        if(!link||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
        cancel();departure=null;save();
        const saved={x:win.scrollX,y:win.scrollY};
        if(search()&&/\/entry(?:\?|\/)/.test(link.getAttribute('href')||'')){
            const mediaId=/[?&]id=(\d+)/.exec(link.getAttribute('href'))?.[1];
            const card=mediaId&&win.document.querySelector('[data-search-page-list] [data-media-id="'+mediaId+'"]');
            saved.anchor=card?{mediaId,top:card.getBoundingClientRect().top}:{href:link.getAttribute('href'),top:link.getBoundingClientRect().top};
        }
        departure={key:current.key,saved};save();
    },true);
    for(const type of ['wheel','touchstart','pointerdown','keydown'])win.addEventListener(type,event=>{
        cancel();
    },{passive:true});
    new win.MutationObserver(schedule).observe(win.document.documentElement,{childList:true,subtree:true});
    if(win.ResizeObserver)new win.ResizeObserver(schedule).observe(win.document.documentElement);
    const style=win.document.createElement('style');style.textContent='[data-entry-back-navigation]{position:relative;z-index:20;padding:12px 16px 0}[data-entry-back-button]{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid #ffffff20;border-radius:10px;background:#202026;color:#e8e8ee;cursor:pointer;transition:background .15s}[data-entry-back-button]:hover{background:#363640}[data-entry-back-button]:focus-visible{outline:2px solid #818cf8;outline-offset:3px}';win.document.head.append(style);
    const api={
        connectRouter(value){value.subscribe('onRendered',()=>{router=value;schedule()})},
        setSearchParams(value){liveParams=clone(value)},
        restoreSearch(){return search()?clone(entries.get(key())?.params):null},
        back(){cancel();if(entries.get(key())?.parent)win.history.back();else if(router)router.navigate({to:'/search'});else win.location.assign('/search')},
        backButton(jsx){return jsx.jsx('div',{'data-entry-back-navigation':true,children:jsx.jsx('button',{type:'button','data-entry-back-button':true,'aria-label':'Go back',title:'Go back',onClick:api.back,children:jsx.jsx('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round',children:jsx.jsx('path',{d:'m12 19-7-7 7-7M5 12h14'})})})})},
    };
    return api;
});
