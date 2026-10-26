"""Exact official 3.10.4 navigation patches; fail on unexpected builds."""
SEARCH_PATH='web-denshi/static/js/async/3067.23d2cc71.js'
def once(text,old,new,count=1):
    if text.count(old)!=count: raise ValueError('Unexpected navigation bundle: '+old[:70])
    return text.replace(old,new)
def patch_search(raw):
    text=raw.decode()
    text=once(text,'p[0]!==A?(a=["advanced-search-anime",A]','window.SeanimeNavigation?.setSearchParams(A);p[0]!==A?(a=["advanced-search-anime",A]')
    text=once(text,'m=()=>{(j||P||E||T||w||k||D||M)&&L(','m=()=>{let saved=window.SeanimeNavigation?.restoreSearch();if(saved){L(saved);return}(j||P||E||T||w||k||D||M)&&L(')
    text=once(text,'refetchOnMount:!0','refetchOnMount:!1,gcTime:864e5',2)
    return text.encode()
def patch_entry(raw):
    text=once(raw.decode(),'"data-anime-entry-list-data":K,children:[B,et,ea]','"data-anime-entry-list-data":K,children:[window.SeanimeNavigation?.backButton(n),B,et,ea]')
    return text.encode()
def patch_bootstrap(raw,search_hash):
    text=once(raw.decode(),'3067:"23d2cc71"','3067:"'+search_hash+'"')
    text=once(text,'return r&&(o.subscribe("onBeforeLoad"','return window.SeanimeNavigation?.connectRouter(o),!window.SeanimeNavigation&&r&&(o.subscribe("onBeforeLoad"')
    return text.encode()
