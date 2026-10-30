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

from firefox_session import FirefoxSession
from site_agent import SiteAgent

ROOTS = {'yts':'https://yts.lt', 'hydra':'https://hydrahd.gd', 'anizone':'https://anizone.to', 'nyaa':'https://nyaa.si', 'animetosho':'https://animetosho.org'}
KISSKH = 'https://kisskh.co/api/DramaList/'
# kisskh has no genres; Dramaday's WordPress tags (Korean dramas) supply them, each title is then found on kisskh
DRAMADAY = 'https://dramaday.me/wp-json/wp/v2/posts'
PROVENANCE = {'movies':'https://rentry.org/megathread-movies-and-tv','anime':'https://rentry.org/megathread-anime'}

def fetch(url, referer=None):
    req=R.Request(url,headers={'User-Agent':'Mozilla/5.0 Seanime/3.10.4'+(' (https://github.com/Elias966/seanime)' if url.startswith(WIKIDATA) else ''),'Referer':referer or U.urlunsplit((*U.urlsplit(url)[:2], '/', '', '')),'Accept':'application/json,text/html,application/xml;q=0.9,*/*;q=0.8'})
    with R.urlopen(req,timeout=18) as r:
        data=r.read(6*1024*1024+1)
        if len(data)>6*1024*1024:raise ValueError('Source response too large')
        text=data.decode('utf-8',errors='replace')
        if re.search(r'<title>\s*(?:Just a moment|Attention Required)|cf-turnstile|g-recaptcha',text,re.I):
            raise ValueError('Source requires verification; it has been skipped')
        return text

def _words(t):return re.findall(r'[a-z0-9]+',html.unescape(t).lower().replace("'",''))
def release_episode(name):
    """Season/episode of a release name. A pack has no episode, and covers seasons first..last"""
    n=name.replace('_',' ').replace('.',' ')
    m=re.search(r'\bS(\d{1,2})\s?E(\d{1,4})\b',n,re.I) or re.search(r'\b(\d{1,2})x(\d{2,3})\b',n)
    if m:return {'season':int(m[1]),'episode':int(m[2]),'pack':False}
    m=re.search(r'\bS(\d{1,2})\s?-\s?S?(\d{1,2})\b',n,re.I) or re.search(r'\bSeasons?\s?(\d{1,2})\s?(?:-|to)\s?(\d{1,2})\b',n,re.I)
    if m:return {'season':int(m[1]),'last':int(m[2]),'episode':None,'pack':True}
    m=re.search(r'\bS(\d{1,2})\b',n,re.I) or re.search(r'\bSeason\s?(\d{1,2})\b',n,re.I)
    if m:return {'season':int(m[1]),'last':int(m[1]),'episode':None,'pack':True}
    m=re.search(r'\b(?:E|EP|Episode)\s?(\d{1,4})\b',n,re.I)
    if m:return {'season':None,'episode':int(m[1]),'pack':False}
    if re.search(r'\b(?:complete|all seasons)\b',n,re.I):return {'season':None,'episode':None,'pack':True}
    return None
def series_torrents(fetcher,imdb,title):
    want=_words(title);out={}
    def named(n):
        w=_words(n);return want and w[:len(want)]==want
    if re.fullmatch(r'tt\d{5,10}',imdb or ''):
        for page in range(1,4):
            try:data=json.loads(fetcher('https://eztv1.xyz/api/get-torrents?'+U.urlencode({'imdb_id':imdb[2:],'limit':100,'page':page})))
            except Exception:break
            for t in data.get('torrents') or []:
                h=str(t.get('hash','')).lower();ep=release_episode(t.get('filename') or t.get('title') or '')
                if re.fullmatch('[a-f0-9]{40}',h) and ep and named(t.get('title') or ''):out[h]={'hash':h,'title':t.get('filename') or t['title'],'size':int(t.get('size_bytes') or 0),'seeds':int(t.get('seeds') or 0),**ep}
            if page*100>=int(data.get('torrents_count') or 0):break
    if want:
        try:data=json.loads(fetcher('https://torrents-csv.com/service/search?'+U.urlencode({'q':' '.join(want),'size':100})))
        except Exception:data={}
        for t in data.get('torrents') or []:
            h=str(t.get('infohash','')).lower();ep=release_episode(t.get('name',''))
            if re.fullmatch('[a-f0-9]{40}',h) and ep and named(t.get('name','')) and h not in out:out[h]={'hash':h,'title':t['name'],'size':int(t.get('size_bytes') or 0),'seeds':int(t.get('seeders') or 0),**ep}
    return sorted(out.values(),key=lambda x:(not x['pack'],x['season'] or 0,x['episode'] or 0,-x['seeds']))
# 1337x sits behind a human check, so it is read through the hidden Firefox session
X1337='https://1337x.to'
X1337_CATEGORY={'movies':'Movies','series':'TV','anime':'Anime'}
def x1337_size(text):
    m=re.match(r'\s*([\d.,]+)\s*([KMGT])i?B',text or '',re.I)
    return int(float(m[1].replace(',',''))*1024**('KMGT'.index(m[2].upper())+1)) if m else 0
def x1337_rows(text):
    """Result rows of a 1337x search page"""
    rows=[]
    for row in re.findall(r'<tr>\s*<td class="coll-1 name">.*?</tr>',text,re.S):
        link=re.search(r'<a href="(/torrent/\d+/[^"]*)"[^>]*>(.*?)</a>',row,re.S)
        seeds=re.search(r'class="coll-2 seeds">(\d+)',row);peers=re.search(r'class="coll-3 leeches">(\d+)',row)
        size=re.search(r'class="coll-4 size[^"]*">([^<]+)',row);date=re.search(r'class="coll-date">([^<]+)',row)
        if link:rows.append({'path':html.unescape(link[1]),'title':html.unescape(re.sub(r'<[^>]+>','',link[2])).strip(),'seeds':int(seeds[1]) if seeds else 0,'peers':int(peers[1]) if peers else 0,'size':size[1].strip() if size else '','date':html.unescape(date[1]).strip() if date else ''})
    return rows
def x1337_search(session,query,category='',pages=1,limit=30,keep=None,known=None):
    """Best seeded releases with their hashes. The hash is on each release's page, those are read a few at a time."""
    q=U.quote(re.sub(r'\s+',' ',query).strip(),safe='');name=X1337_CATEGORY.get(category)
    base=X1337+(f'/sort-category-search/{q}/{name}/seeders/desc/' if name else f'/sort-search/{q}/seeders/desc/')
    rows={}
    for text in session.fetch_all([f'{base}{n}/' for n in range(1,pages+1)]):
        for row in x1337_rows(text):rows.setdefault(row['path'],row)
    rows=sorted((r for r in rows.values() if not keep or keep(r['title'])),key=lambda r:-r['seeds'])[:limit]
    known=known if known is not None else {}
    missing=[r['path'] for r in rows if r['path'] not in known]
    for i in range(0,len(missing),5):
        part=missing[i:i+5]
        for path,text in zip(part,session.fetch_all([X1337+x for x in part])):
            m=re.search(r'magnet:\?xt=urn:btih:([a-fA-F0-9]{40})',text)
            if m:known[path]=m[1].lower()
    return [{**r,'hash':known[r['path']]} for r in rows if r['path'] in known]
def x1337_date(text):
    m=re.search(r"([A-Z][a-z]{2})\.? (\d{1,2})\w* '(\d\d)",text or '')
    if m and m[1] in MONTHS:return '20%s-%02d-%02dT00:00:00Z'%(m[3],MONTHS.index(m[1])+1,int(m[2]))
    return time.strftime('%Y-%m-%dT00:00:00Z',time.gmtime())
MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
X1337_EXTENSION='class Provider {\n    getSettings() {\n        return { type: "main", canSmartSearch: false, smartSearchFilters: [], supportsAdult: false }\n    }\n    async getLatest() {\n        return []\n    }\n    async search(opts) {\n        // Waits for Firefox when the site asks the person for a human check\n        const res = await fetch("http://127.0.0.1:%d/media/torrents?provider=1337x&cat=anime&q=" + encodeURIComponent(opts.query || ""), { timeout: 240 })\n        if (!res.ok) throw new Error((await res.json()).error || "1337x is unavailable")\n        return (await res.json()).map(t => {\n            const quality = /\\b(2160|1080|720|480)p\\b/i.exec(t.title)\n            const episode = $habari.parse(t.title).episode_number\n            const batch = /\\b(batch|complete|season \\d+)\\b|\\b\\d+\\s?-\\s?\\d+\\b/i.test(t.title)\n            return {\n                name: t.title, date: t.iso, size: t.size_bytes, formattedSize: t.size, seeders: t.seeds, leechers: t.peers,\n                downloadCount: 0, link: t.url, downloadUrl: "", magnetLink: t.magnet, infoHash: t.hash,\n                resolution: quality ? quality[0].toLowerCase() : "", isBatch: batch,\n                episodeNumber: !batch && episode && episode.length === 1 ? (parseInt(episode[0]) || -1) : -1,\n                releaseGroup: "", isBestRelease: false, confirmed: false,\n            }\n        })\n    }\n    async smartSearch(opts) {\n        return this.search(opts)\n    }\n    async getTorrentInfoHash(t) {\n        return t.infoHash\n    }\n    async getTorrentMagnetLink(t) {\n        return t.magnetLink\n    }\n}\n'
def install_x1337_extension(port,directory=None):
    """Offers 1337x to the anime torrent search, which only takes its sources from extensions"""
    folder=Path(directory or Path(os.environ.get('XDG_CONFIG_HOME',str(Path.home()/'.config')))/'Seanime/extensions');path=folder/'seanime-1337x.json'
    text=json.dumps({'id':'seanime-1337x','name':'1337x','version':'1.0.0','manifestURI':'builtin','language':'typescript','type':'anime-torrent-provider','description':'Everything on 1337x. Read through Firefox, which appears only for a human check.','author':'Seanime','icon':'','website':X1337,'lang':'multi','payload':X1337_EXTENSION%port},indent=2)
    try:
        if path.read_text()==text:return
    except OSError:pass
    folder.mkdir(parents=True,exist_ok=True);path.write_text(text)
def movie_release(row):
    """A 1337x release in the form of the movie page's release list"""
    n=row['title'];q=re.search(r'\b(2160p|4k|1440p|1080p|720p|576p|480p)\b',n,re.I)
    kind=next((label for pattern,label in ((r'\b(?:cam|camrip|hdcam|ts|hdts|telesync|tc)\b','cam'),(r'\bblu-?ray|\bbrrip|\bbdrip|\bremux','bluray'),(r'\bweb-?(?:dl|rip)?\b','web'),(r'\bhdtv\b','tv'),(r'\bdvd','dvd')) if re.search(pattern,n,re.I)),'')
    codec=re.search(r'\b(x ?265|h ?\.?265|hevc|x ?264|h ?\.?264|av1)\b',n,re.I)
    quality=(q[1].lower().replace('4k','2160p') if q else 'CAM' if kind=='cam' else 'SD')
    return {'hash':row['hash'],'name':n,'quality':quality,'type':kind,'video_codec':codec[1].replace(' ','').replace('.','').upper() if codec else '','size':row['size'],'size_bytes':x1337_size(row['size']),'seeds':row['seeds'],'peers':row['peers']}
def movie_named(title,year):
    want=_words(title)
    def keep(name):
        w=_words(name)
        return bool(want) and w[:len(want)]==want and (not year or w[len(want):len(want)+1]==[str(year)])
    return keep
def series_named(title):
    want=_words(title)
    return lambda name:bool(want) and _words(name)[:len(want)]==want
def x1337_series(session,title,known=None):
    named=series_named(title);out={}
    for r in x1337_search(session,' '.join(_words(title)),'series',pages=2,limit=60,keep=lambda n:named(n) and release_episode(n) is not None,known=known):
        out[r['hash']]={'hash':r['hash'],'title':r['title'],'size':x1337_size(r['size']),'seeds':r['seeds'],**release_episode(r['title'])}
    return sorted(out.values(),key=lambda x:(not x['pack'],x['season'] or 0,x['episode'] or 0,-x['seeds']))
def dramaday_links(fetcher,title):
    """Episode download links of a Dramaday drama, per release group and quality. The links go through the site's
    shorteners, they are opened for the user and never followed here."""
    want=_words(title)
    posts=json.loads(fetcher(DRAMADAY+'?'+U.urlencode({'search':title[:120],'categories':3,'per_page':10,'_fields':'slug,title,link,content'})))
    post=next((p for p in posts if _words(p['title']['rendered'])==want),None) or next((p for p in posts if _words(p['title']['rendered'])[:len(want)]==want),None)
    if not post:return {'page':None,'episodes':[]}
    text=post['content']['rendered'];group='';episodes=[]
    for row in re.findall(r'<tr>(.*?)</tr>',text,re.S):
        cells=re.findall(r'<td([^>]*)>(.*?)</td>',row,re.S)
        if len(cells)<3:continue
        label=re.sub(r'\s+',' ',html.unescape(re.sub(r'<br\s*/?>',' ',cells[0][1]))).strip()
        if 'data-colspan' in cells[0][0]:group=label;continue
        if not label or label.lower()=='episode':continue
        qualities=[q.strip() for q in re.split(r'<br\s*/?>',html.unescape(re.sub(r'<(?!br)[^>]+>','',cells[1][1]))) if q.strip()]
        lines=re.split(r'<br\s*/?>',cells[2][1]);options=[]
        for i,line in enumerate(lines):
            links=[{'host':re.sub(r'<[^>]+>','',html.unescape(t)).strip()[:40],'url':html.unescape(u)} for u,t in re.findall(r'<a[^>]+href="(https://[^"]+)"[^>]*>(.*?)</a>',line,re.S)]
            if links:options.append({'quality':qualities[i] if i<len(qualities) else (qualities[-1] if qualities else ''),'links':links[:8]})
        m=re.search(r'(\d{1,4})\s*$',label)
        if options:episodes.append({'label':label,'episode':int(m[1]) if m and not re.search('special',label,re.I) else None,'group':group,'options':options})
    return {'page':post.get('link'),'title':html.unescape(post['title']['rendered']),'episodes':episodes}

WIKIDATA='https://www.wikidata.org/w/api.php'
FILM_CLASSES={'Q11424','Q24869','Q506240','Q202866','Q24862','Q17517379'}
def related_titles(fetcher,imdb):
    """Prequels, sequels and spin-offs of an IMDb title from Wikidata ("follows", "followed by", "has spin-off",
    "based on" and the other parts of the series it belongs to). Only entries with an IMDb id are kept."""
    if not re.fullmatch(r'tt\d{5,10}',imdb or ''):return []
    found=json.loads(fetcher(WIKIDATA+'?'+U.urlencode({'action':'query','list':'search','srsearch':'haswbstatement:P345='+imdb,'srlimit':1,'format':'json'})))['query']['search']
    if not found:return []
    qid=found[0]['title']
    def entities(ids,props):
        out={}
        ids=[i for i in dict.fromkeys(ids) if re.fullmatch(r'Q\d+',i or '')]
        for i in range(0,len(ids),40):out.update(json.loads(fetcher(WIKIDATA+'?'+U.urlencode({'action':'wbgetentities','ids':'|'.join(ids[i:i+40]),'props':props,'languages':'en','format':'json'}))).get('entities',{}))
        return out
    def values(e,p):return [x['mainsnak'].get('datavalue',{}).get('value',{}).get('id') for x in e.get('claims',{}).get(p,[]) if x.get('mainsnak',{}).get('snaktype')=='value']
    me=entities([qid],'labels|claims').get(qid,{})
    rel={}
    for p,name in (('P155','Prequel'),('P156','Sequel'),('P2512','Spin-off'),('P144','Based on')):
        for q in values(me,p):rel.setdefault(q,name)
    # Titles that point back here: one that follows this one is a sequel (works "based on" it are left out, those
    # are mostly parodies)
    try:back=json.loads(fetcher(WIKIDATA+'?'+U.urlencode({'action':'query','list':'search','srsearch':'haswbstatement:P155=%s|P156=%s'%(qid,qid),'srlimit':30,'format':'json'})))['query']['search']
    except Exception:back=[]
    for q in [b['title'] for b in back]:rel.setdefault(q,'?')
    series=values(me,'P179')
    for part in entities(series,'claims').values():
        for q in values(part,'P527'):rel.setdefault(q,'Same series')
    # Other titles of the same franchise, and other adaptations of the book or game this one is based on
    for p,f,name in [('P8345',f,'Same franchise') for f in values(me,'P8345')[:2]]+[('P144',f,'Same story') for f in values(me,'P144')[:2]]:
        try:same=json.loads(fetcher(WIKIDATA+'?'+U.urlencode({'action':'query','list':'search','srsearch':'haswbstatement:%s=%s'%(p,f),'srlimit':20,'format':'json'})))['query']['search']
        except Exception:same=[]
        for b in same:rel.setdefault(b['title'],name)
    rel.pop(qid,None)
    # "follows" on a TV series is often only the show before it in the same time slot: kept when it is in the same
    # series or shares the title's first words
    mine=_words(me.get('labels',{}).get('en',{}).get('value',''))[:2];series=set(series)
    out=[]
    for q,e in entities(list(rel)[:40],'labels|claims').items():
        if rel[q]=='?':rel[q]='Sequel' if qid in values(e,'P155') else 'Prequel'
        if rel[q] in ('Prequel','Sequel') and not (series&set(values(e,'P179')) or (mine and _words(e.get('labels',{}).get('en',{}).get('value',''))[:len(mine)]==mine)):continue
        ids=[x['mainsnak'].get('datavalue',{}).get('value') for x in e.get('claims',{}).get('P345',[])]
        tt=next((i for i in ids if isinstance(i,str) and re.fullmatch(r'tt\d{5,10}',i)),None)
        label=e.get('labels',{}).get('en',{}).get('value')
        if not tt or tt==imdb or not label or 'Q7889' in values(e,'P31'):continue
        dates=[x['mainsnak'].get('datavalue',{}).get('value',{}).get('time','') for x in e.get('claims',{}).get('P577',[])]
        year=min((d[1:5] for d in dates if re.match(r'\+\d{4}',d)),default='')
        out.append({'imdb':tt,'name':label,'relation':rel[q],'type':'movie' if FILM_CLASSES&set(values(e,'P31')) else 'series','year':year})
    order={'Prequel':0,'Sequel':1,'Same series':2,'Spin-off':3,'Same franchise':4,'Same story':5,'Based on':6}
    return sorted(out,key=lambda x:(order[x['relation']],x['year'] or '9999'))

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
        self.fetcher=fetcher;self.lock=threading.RLock();self._firefox=None;self._agent=None;self.x1337_known={}
        try:self.library=json.loads((self.directory/'library.json').read_text())
        except (OSError,ValueError):self.library={}
    @property
    def firefox(self):
        with self.lock:
            if self._firefox is None:self._firefox=FirefoxSession()
            return self._firefox
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
        if path=='/media/agent-jobs':return self.agent.list()
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
                if provider=='kisskh':
                    # East and South Asian dramas from kisskh's own API (country 0 all, 1 China, 2 Korea, 3 Japan...; order 1 popular, 2 recently updated, 3 new;
                    # type 1 TV series, 2 movies (0 would add kisskh's anime and Hollywood sections); status 0 all, 1 ongoing, 2 completed;
                    # genre is a Dramaday tag id)
                    kind=int(arg('type','1'))
                    if genre.isdigit() and not query:
                        posts=json.loads(self.fetcher(DRAMADAY+'?'+U.urlencode({'tags':genre,'categories':692 if kind==2 else 3,'page':page,'per_page':20,'_fields':'title'})))
                        titles=[html.unescape(p.get('title',{}).get('rendered','')).strip() for p in posts if isinstance(p,dict)]
                        norm=lambda t:re.sub(r'[^a-z0-9]+','',re.sub(r'\s*\(\d{4}\)\s*$','',t.lower()))
                        def find(title):
                            try:found=self.cached('kisskh-search:%d:%s'%(kind,title),lambda:json.loads(self.fetcher(KISSKH+'Search?'+U.urlencode({'q':title,'type':kind}))),age=7*86400)
                            except Exception:return None
                            return next((a for a in found if a.get('id') and norm(a.get('title',''))==norm(title)),None)
                        from concurrent.futures import ThreadPoolExecutor
                        with ThreadPoolExecutor(8) as pool:data=[a for a in pool.map(find,titles) if a]
                        # Dramaday doesn't say how many there are here; a full page means there may be more
                        total=(page-1)*20+len(data)+(20 if len(posts)==20 else 0)
                    elif query:data=json.loads(self.fetcher(KISSKH+'Search?'+U.urlencode({'q':query,'type':kind})));total=len(data)
                    else:
                        data=json.loads(self.fetcher(KISSKH+'List?'+U.urlencode({'page':page,'type':kind,'sub':0,'country':int(arg('country','0')),'status':int(arg('status','0')),'order':int(arg('order','1')),'pageSize':30})))
                        total=data.get('totalCount',0);data=data.get('data',[])
                    return {'items':[{'id':str(a['id']),'provider':'kisskh','title':a.get('title',''),'poster':a.get('thumbnail',''),'episodes':a.get('episodesCount'),'type':'series'} for a in data if a.get('id')],'total':total,'page':page}
                raise ValueError('Unknown catalog')
            return self.cached('catalog:'+json.dumps(q,sort_keys=True),load)
        if path=='/media/drama':
            drama=id_part(arg('id'))
            return self.cached('drama:'+drama,lambda:json.loads(self.fetcher(KISSKH+'Drama/'+drama+'?isq=false')))
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
        if path=='/media/related':
            imdb=arg('imdb')[:12];return self.cached('related:'+imdb,lambda:related_titles(self.fetcher,imdb),age=3*86400)
        if path=='/media/series-torrents':
            title=arg('title')[:160]
            if arg('source')=='1337x':return self.cached('1337x-series:'+title,lambda:x1337_series(self.firefox,title,self.x1337_known),age=600)
            return series_torrents(self.fetcher,arg('imdb')[:12],title)
        if path=='/media/movie-torrents':
            title=arg('title')[:160];year=arg('year')[:4]
            keep=movie_named(title,year)
            return self.cached(f'1337x-movie:{title}:{year}',lambda:[movie_release(r) for r in x1337_search(self.firefox,f'{title} {year}'.strip(),'movies',limit=24,keep=keep,known=self.x1337_known)],age=600)
        if path=='/media/series-links':
            if arg('site','dramaday')!='dramaday':raise ValueError('Unknown download site')
            return dramaday_links(self.fetcher,arg('title')[:160])
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
            if provider=='1337x':
                category=arg('cat');category=category if category in X1337_CATEGORY else ''
                return self.cached(f'1337x:{category}:{query}',lambda:[{'title':r['title'],'magnet':f"magnet:?xt=urn:btih:{r['hash']}&dn={U.quote(r['title'])}",'hash':r['hash'],'seeds':r['seeds'],'peers':r['peers'],'size':r['size'],'size_bytes':x1337_size(r['size']),'date':r['date'],'iso':x1337_date(r['date']),'url':X1337+r['path']} for r in x1337_search(self.firefox,query,category,known=self.x1337_known)],age=600)
            raise ValueError('Unknown torrent source')
        if path=='/media/subtitle':
            url=arg('url');parts=U.urlsplit(url)
            if parts.scheme!='https' or not (parts.hostname or '').endswith('.xin-cdn.xyz') or not parts.path.endswith(('.srt','.vtt')) or parts.username or parts.port not in (None,443):raise ValueError('Unsupported subtitle source')
            text=self.fetcher(url)
            if not text.lstrip().startswith('WEBVTT'):text='WEBVTT\n\n'+re.sub(r'(\d\d:\d\d:\d\d),(\d{3})',r'\1.\2',text.lstrip('\ufeff'))
            return {'vtt':text}
        raise ValueError('Unknown media endpoint')
    def open_in_firefox(self,value):
        """Sites with a human check keep their clearance in Firefox only, so they are used there"""
        source=next((x for x in self.get('/media/source-registry',{})['sources'] if x['id']==value.get('id')),None)
        if source is None or source['mode']!='firefox':raise ValueError('This source does not open in Firefox')
        self.firefox.open_site(source['browseUrl'] or source['url'])
        return {'ok':True}
    @property
    def agent(self):
        with self.lock:
            if self._agent is None:self._agent=SiteAgent(lambda:self.firefox)
            return self._agent
    def agent_start(self,value):
        source=next((x for x in self.get('/media/source-registry',{})['sources'] if x['id']==value.get('id')),None)
        if source is None or source['mode'] not in ('site','firefox') or source.get('excluded'):raise ValueError('This website cannot be used')
        return self.agent.start(source,value)
    def shutdown(self):
        if self._firefox:self._firefox.shutdown()
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
        if not isinstance(item,dict) or item.get('provider')not in ('yts','hydra','anizone','cinemeta','kisskh'):raise ValueError('Invalid library item')
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
