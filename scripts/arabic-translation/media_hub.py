"""Built-in movie/anime catalogs. Fixed public sources; never evaluates site code."""
from html.parser import HTMLParser
import html
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.parse as U
import urllib.request as R
import xml.etree.ElementTree as ET

ROOTS = {'yts':'https://yts.lt', 'hydra':'https://hydrahd.gd', 'anizone':'https://anizone.to', 'nyaa':'https://nyaa.si', 'animetosho':'https://animetosho.org'}
PROVENANCE = {'movies':'https://rentry.org/megathread-movies-and-tv','anime':'https://rentry.org/megathread-anime'}

def fetch(url, referer=None):
    req=R.Request(url,headers={'User-Agent':'Mozilla/5.0 Seanime/3.10.4','Referer':referer or U.urlunsplit((*U.urlsplit(url)[:2], '/', '', '')),'Accept':'application/json,text/html,application/xml;q=0.9,*/*;q=0.8'})
    with R.urlopen(req,timeout=18) as r:
        data=r.read(6*1024*1024+1)
        if len(data)>6*1024*1024:raise ValueError('Source response too large')
        text=data.decode('utf-8',errors='replace')
        if re.search(r'<title>\s*(?:Just a moment|Attention Required)|cf-turnstile|g-recaptcha',text,re.I):
            raise ValueError('Source requires verification; it has been skipped')
        return text

class Page(HTMLParser):
    def __init__(self,text):
        super().__init__(convert_charrefs=True);self.arrays=[];self.links=[];self.images=[];self.current=None;self.feed(text)
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if a.get('x-data'):
            for m in re.finditer(r"JSON.parse\('([^']*)'\)",a['x-data']):
                try:self.arrays.append(json.loads(json.loads('"'+m[1].replace('"','\\"')+'"')))
                except (ValueError,TypeError):pass
        if tag=='a':self.current={'url':a.get('href',''),'title':a.get('title',''),'text':''};self.links.append(self.current)
        if tag=='img':
            image={'url':a.get('data-src') or a.get('src',''),'title':a.get('alt',''),'link':self.current['url'] if self.current else ''};self.images.append(image)
    def handle_endtag(self,tag):
        if tag=='a':self.current=None
    def handle_data(self,data):
        if self.current:self.current['text']+=data

def id_part(value):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',str(value)):raise ValueError('Invalid source ID')
    return str(value)

def anizone_items(text):
    for value in Page(text).arrays:
        if isinstance(value,list) and value and isinstance(value[0],dict) and 'main_title'in value[0]:return value
    return []

def anime_item(a):
    return {'id':a['slug'],'provider':'anizone','title':a.get('title_list',{}).get('1') or a.get('main_title','Anime'),'poster':a.get('cover',''),'year':a.get('start_year'),'episodes':a.get('episode_count'),'genres':[t['name'] for t in a.get('tags',[])], 'description':'','type':'anime'}

def hydra_items(text):
    out=[];seen=set()
    for image in Page(text).images:
        path=U.urlsplit(image['link']).path.strip()
        if not re.fullmatch(r'/movie/[a-zA-Z0-9-]+',path) or path in seen:continue
        title=re.sub(r'\s+poster$','',image['title'],flags=re.I).strip()
        if not title or not image['url'].startswith('https://image.tmdb.org/'):continue
        seen.add(path);out.append({'id':path.split('/')[-1],'provider':'hydra','title':title,'poster':image['url'],'type':'movie','description':''})
    return out

def torrent_rss(text):
    if len(text)>6*1024*1024:raise ValueError('Feed too large')
    root=ET.fromstring(text);out=[]
    for item in root.findall('./channel/item')[:75]:
        fields={k.tag.split('}')[-1]:(k.text or '') for k in item}
        h=fields.get('infoHash','');link=fields.get('link','')
        if not re.fullmatch('[a-fA-F0-9]{40}',h):continue
        out.append({'title':fields.get('title',''),'magnet':'magnet:?xt=urn:btih:'+h+'&dn='+U.quote(fields.get('title',''))+'&tr='+U.quote('udp://tracker.opentrackr.org:1337/announce'), 'hash':h.lower(),'seeds':fields.get('seeders',''),'size':fields.get('size',''),'url':link})
    return out

class MediaHub:
    def __init__(self,directory=None,fetcher=fetch):
        self.directory=Path(directory or Path(os.environ.get('XDG_DATA_HOME',str(Path.home()/'.local/share')))/'seanime/media-hub');self.directory.mkdir(parents=True,exist_ok=True)
        self.fetcher=fetcher;self.lock=threading.RLock()
        try:self.library=json.loads((self.directory/'library.json').read_text())
        except (OSError,ValueError):self.library={}
    def cached(self,key,fn,age=3600):
        import hashlib
        path=self.directory/(hashlib.sha256(key.encode()).hexdigest()+'.json')
        old=None
        try:
            old=json.loads(path.read_text())
            if time.time()-path.stat().st_mtime<age:return old
        except (OSError,ValueError):pass
        try:value=fn();path.write_text(json.dumps(value,ensure_ascii=False));return value
        except Exception:
            if old is not None:return old
            raise
    def get(self,path,q):
        arg=lambda k,d='':q.get(k,[d])[0]
        if path=='/media/source-registry':
            candidates=[Path(__file__).parent/'sources.json',Path(__file__).parent.parent/'media-hub/sources.json',Path(__file__).parent/'media-hub/sources.json']
            for candidate in candidates:
                if candidate.is_file():return json.loads(candidate.read_text())
            raise ValueError('Source inventory is unavailable')
        if path=='/media/sources':return {'provenance':PROVENANCE,'sources':[{'id':k,'name':{'yts':'YTS','hydra':'HydraHD','anizone':'AniZone','nyaa':'Nyaa','animetosho':'AnimeTosho'}[k],'url':v,'kind':'movies' if k in ('yts','hydra') else 'anime'} for k,v in ROOTS.items()]}
        if path=='/media/source-preferences':return self.source_preferences()
        if path=='/media/library':
            with self.lock:return list(self.library.values())
        if path=='/media/catalog':
            provider=arg('provider','yts');query=arg('q')[:180];page=max(1,min(1000,int(arg('page','1'))));genre=arg('genre')[:30]
            def load():
                if provider=='yts':
                    params={'limit':24,'page':page,'sort_by':arg('sort','download_count'),'query_term':query,'genre':genre,'minimum_rating':arg('rating','0')}
                    data=json.loads(self.fetcher(ROOTS['yts']+'/api/v2/list_movies.json?'+U.urlencode(params)))
                    if data.get('status')!='ok':raise ValueError('Movie catalog unavailable')
                    data=data.get('data',{});items=[]
                    for a in data.get('movies',[]):items.append({'id':str(a['id']),'provider':'yts','title':a['title'],'year':a.get('year'),'rating':a.get('rating'),'genres':a.get('genres',[]),'poster':a.get('medium_cover_image',''),'description':a.get('summary',''),'imdb':a.get('imdb_code'),'type':'movie','torrents':a.get('torrents',[])})
                    return {'items':items,'total':data.get('movie_count',0),'page':page}
                if provider=='hydra':
                    url=ROOTS['hydra']+('/index.php?menu=search&query='+U.quote(query) if query else '/movies/'+str(page))
                    return {'items':hydra_items(self.fetcher(url)),'page':page}
                if provider=='anizone':
                    url=ROOTS['anizone']+'/anime?'+U.urlencode({'search':query,'page':page})
                    return {'items':[anime_item(a) for a in anizone_items(self.fetcher(url)) if not a.get('is_unsafe')],'page':page}
                raise ValueError('Unknown catalog')
            return self.cached('catalog:'+json.dumps(q,sort_keys=True),load)
        if path=='/media/episodes':
            slug=id_part(arg('id'));text=self.fetcher(ROOTS['anizone']+'/anime/'+slug,ROOTS['anizone']+'/anime')
            for a in Page(text).arrays:
                if isinstance(a,list) and a and isinstance(a[0],dict) and 'videos_count'in a[0]:
                    return [{'id':id_part(e['slug']),'title':e.get('title_list',{}).get('1') or 'Episode '+str(e['slug']),'number':e['slug']} for e in a]
            return []
        if path=='/media/anime-stream':
            slug=id_part(arg('id'));ep=id_part(arg('episode'));page=Page(self.fetcher(ROOTS['anizone']+'/anime/'+slug+'/'+ep,ROOTS['anizone']+'/anime/'+slug))
            for a in page.arrays:
                if isinstance(a,dict) and str(a.get('src','')).startswith('https://') and '.m3u8' in a['src']:
                    return {'url':a['src'],'subtitles':[{'url':s['file'],'language':s.get('language'),'label':s.get('title')} for s in a.get('subtitles',[])],'provider':'AniZone'}
            raise ValueError('No playable source for this episode')
        if path=='/media/movie-stream':
            slug=id_part(arg('id'));url=ROOTS['hydra']+'/movie/'+slug;text=self.fetcher(url)
            match=re.search(r"\$\.get\('/ajax/mov_0\.php',\s*\{\"i\":\"(tt\d+)\",\"t\":\"(\d+)\"",text)
            if not match:raise ValueError('No movie servers found')
            player=self.fetcher(ROOTS['hydra']+'/ajax/mov_0.php?'+U.urlencode({'i':match[1],'t':match[2]}),url)
            # Use the source's actual provider links, never generated guessed URLs.
            urls=list(dict.fromkeys(html.unescape(u) for u in re.findall(r'https://(?:www\.1src\.org|ythd\.org|vixsrc\.to|play\.xpass\.top)/[^\s<>"\x27]+',player)))
            return {'servers':[{'name':U.urlsplit(u).hostname,'url':u,'type':'embed'} for u in urls]}
        if path=='/media/torrents':
            provider=arg('provider','nyaa');query=arg('q')[:180]
            if provider=='nyaa':return torrent_rss(self.fetcher(ROOTS['nyaa']+'/?'+U.urlencode({'page':'rss','q':query,'c':'1_2','f':'0'})))
            if provider=='animetosho':
                text=self.fetcher(ROOTS['animetosho']+'/search?q='+U.quote(query));out=[]
                for block in re.split(r'<div class="home_list_entry',text)[1:76]:
                    page=Page(block);mag=next((a['url'] for a in page.links if a['url'].startswith('magnet:?')),None)
                    title=next((a['text'] for a in page.links if '/view/'in a['url'] or '/view/'in a.get('url','')),None)
                    if mag and title:out.append({'title':title.strip(),'magnet':mag,'size':'','seeds':''})
                return out
            raise ValueError('Unknown torrent source')
        if path=='/media/subtitle':
            url=arg('url');parts=U.urlsplit(url)
            if parts.scheme!='https' or not (parts.hostname or '').endswith('.xin-cdn.xyz') or not parts.path.endswith(('.srt','.vtt')) or parts.username or parts.port not in (None,443):raise ValueError('Unsupported subtitle source')
            text=self.fetcher(url)
            if not text.lstrip().startswith('WEBVTT'):text='WEBVTT\n\n'+re.sub(r'(\d\d:\d\d:\d\d),(\d{3})',r'\1.\2',text.lstrip('\ufeff'))
            return {'vtt':text}
        raise ValueError('Unknown media endpoint')
    def source_preferences(self):
        with self.lock:
            try:
                value=json.loads((self.directory/'source-preferences.json').read_text())
                ids=value['disabledSourceIds']
                if not isinstance(ids,list) or any(not isinstance(x,str) for x in ids):raise ValueError('Invalid source preferences')
                return {'disabledSourceIds':sorted(set(ids))}
            except FileNotFoundError:return {'disabledSourceIds':[]}
    def set_source_enabled(self,value):
        source_id=value.get('id');enabled=value.get('enabled')
        if not isinstance(source_id,str) or not isinstance(enabled,bool):raise ValueError('Invalid source preference')
        source=next((x for x in self.get('/media/source-registry',{})['sources'] if x['id']==source_id),None)
        if source is None or enabled and source['mode']=='unavailable':raise ValueError('Source cannot be enabled')
        with self.lock:
            disabled=set(self.source_preferences()['disabledSourceIds'])
            if enabled:disabled.discard(source_id)
            else:disabled.add(source_id)
            result={'disabledSourceIds':sorted(disabled)}
            tmp=self.directory/'source-preferences.tmp';tmp.write_text(json.dumps(result));tmp.replace(self.directory/'source-preferences.json')
            return result

    def save(self,value):
        item=value.get('item');action=value.get('action','save')
        if not isinstance(item,dict) or item.get('provider')not in ('yts','hydra','anizone','cinemeta'):raise ValueError('Invalid library item')
        key=item['provider']+':'+id_part(item.get('id',''))
        with self.lock:
            if action=='remove':self.library.pop(key,None)
            else:self.library[key]=item
            tmp=self.directory/'library.tmp';tmp.write_text(json.dumps(self.library,ensure_ascii=False));tmp.replace(self.directory/'library.json')
            return list(self.library.values())

    def proxy(self,url,base,range_header=None):
        parts=U.urlsplit(url)
        if parts.scheme!='https' or parts.hostname not in ('suzaku.xin-cdn.xyz',) or parts.username or parts.password or parts.port not in (None,443):raise ValueError('Unsupported streaming host')
        headers={'User-Agent':'Mozilla/5.0','Referer':'https://anizone.to/','Origin':'https://anizone.to'}
        if range_header:
            if not re.fullmatch(r'bytes=\d+-\d*',range_header):raise ValueError('Invalid media byte range')
            headers['Range']=range_header
        with R.urlopen(R.Request(url,headers=headers),timeout=25) as response:
            final=U.urlsplit(response.geturl())
            if final.scheme!='https' or final.hostname!='suzaku.xin-cdn.xyz':raise ValueError('Unsupported streaming redirect')
            data=response.read(32*1024*1024+1)
            if len(data)>32*1024*1024:raise ValueError('Stream segment too large')
            code=response.status;kind=response.headers.get('Content-Type','application/octet-stream');content_range=response.headers.get('Content-Range')
        if data.startswith(b'#EXTM3U'):
            def rewrite(value):return base+'/media/proxy?url='+U.quote(U.urljoin(url,value),safe='')
            lines=[]
            for line in data.decode('utf-8').splitlines():
                if line.startswith('#'):line=re.sub(r'URI="([^"]+)"',lambda m:'URI="'+rewrite(m[1])+'"',line)
                elif line.strip():line=rewrite(line.strip())
                lines.append(line)
            data=('\n'.join(lines)+'\n').encode();kind='application/vnd.apple.mpegurl'
        return code,kind,data,content_range
