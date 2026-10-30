import json
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.parse as U
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from patch_media_electron import patch_main,GUARD
import media_hub
from media_hub import MediaHub,Page,hydra_items,torrent_rss,fetch,id_part

ROW1337='<tr><td class="coll-1 name"><a href="/sub/42/0/" class="icon"><i></i></a><a href="/torrent/%d/x/">%s</a><span class="comments">1</span></td>\n<td class="coll-2 seeds">%d</td><td class="coll-3 leeches">64</td><td class="coll-date">Jun. 13th \'12</td><td class="coll-4 size mob-vip">1.9 GB<span class="seeds">9</span></td><td class="coll-5 vip"></td></tr>'
class FakeFirefox:
    def __init__(self,rows):self.rows=rows;self.urls=[]
    def fetch_all(self,urls):
        self.urls+=urls
        return [''.join(ROW1337%r for r in self.rows) if 'search' in u else 'magnet:?xt=urn:btih:'+('%040x'%int(u.split('/')[4])) for u in urls]
class X1337Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
    def hub(self,rows):
        hub=MediaHub(self.tmp.name,lambda *a:'');hub._firefox=FakeFirefox(rows);return hub
    def test_movie_keeps_the_title_and_year(self):
        hub=self.hub([(1,'Inception (2010) 1080p BrRip x264 - YIFY',922),(2,'Inception Dreams 2010 720p',5),(3,'Inception 2010 2160p WEB-DL',50),(4,'Inception 1999 CAM',9)])
        out=hub.get('/media/movie-torrents',{'title':['Inception'],'year':['2010']})
        self.assertEqual([t['quality'] for t in out],['1080p','2160p'])
        self.assertEqual(out[0]['type'],'bluray');self.assertEqual(out[0]['video_codec'],'X264');self.assertEqual(out[0]['seeds'],922);self.assertEqual(out[0]['hash'],'%040x'%1)
        self.assertIn('/sort-category-search/Inception%202010/Movies/seeders/desc/1/',hub._firefox.urls[0])
    def test_series_finds_episodes_and_packs(self):
        hub=self.hub([(1,'The Last of Us S01E02 1080p',10),(2,'The Last of Us S01 COMPLETE',20),(3,'The Last Kingdom S01E01',99),(4,'The Last of Us 2023 poster',99)])
        out=hub.get('/media/series-torrents',{'source':['1337x'],'title':['The Last of Us']})
        self.assertEqual([(t['season'],t['episode'],t['pack']) for t in out],[(1,None,True),(1,2,False)])
    def test_anime_search_and_cached_hashes(self):
        hub=self.hub([(7,'[Group] Frieren - 01 [1080p]',3)])
        out=hub.get('/media/torrents',{'provider':['1337x'],'cat':['anime'],'q':['Frieren']})
        self.assertEqual(out[0]['hash'],'%040x'%7);self.assertTrue(out[0]['magnet'].startswith('magnet:?xt=urn:btih:'));self.assertEqual(out[0]['iso'],'2012-06-13T00:00:00Z');self.assertEqual(out[0]['size_bytes'],int(1.9*1024**3))
        self.assertEqual(len(hub._firefox.urls),2)
        hub.get('/media/torrents',{'provider':['1337x'],'cat':['anime'],'q':['Frieren again']})
        self.assertEqual(len(hub._firefox.urls),3)
    def test_only_checked_sites_open_in_firefox(self):
        hub=self.hub([]);opened=[]
        hub._firefox.open_site=opened.append
        hub.open_in_firefox({'id':'mapple'});self.assertEqual(opened,['https://mapple.tv/'])
        with self.assertRaises(ValueError):hub.open_in_firefox({'id':'hydra'})
    def test_extension_is_written_once(self):
        media_hub.install_x1337_extension(11435,self.tmp.name)
        path=Path(self.tmp.name)/'seanime-1337x.json';value=json.loads(path.read_text())
        self.assertEqual(value['type'],'anime-torrent-provider');self.assertIn('127.0.0.1:11435',value['payload'])

class MediaTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.calls=[]
        def fake(url,*args):
            self.calls.append(url)
            return json.dumps({'status':'ok','data':{'movie_count':1,'movies':[{'id':1,'title':'Test Movie','year':2020,'rating':8,'medium_cover_image':'https://yts.gg/cover.jpg','torrents':[{'hash':'a'*40,'quality':'1080p'}]}]}})
        self.hub=MediaHub(self.tmp.name,fake)
    def test_movie_catalog_encodes_filters_pagination_and_returns_release_metadata(self):
        r=self.hub.get('/media/catalog',{'provider':['yts'],'q':['Movie & Test'],'page':['2'],'genre':['Action']})
        self.assertEqual(r['items'][0]['torrents'][0]['quality'],'1080p');q=U.parse_qs(U.urlsplit(self.calls[0]).query);self.assertEqual(q['query_term'],['Movie & Test']);self.assertEqual(q['page'],['2']);self.assertEqual(q['genre'],['Action'])
    def test_cached_catalog_and_saved_library_survive_restart_without_network(self):
        query={'provider':['yts']};item=self.hub.get('/media/catalog',query)['items'][0];self.hub.save({'item':item})
        second=MediaHub(self.tmp.name,lambda *_: (_ for _ in ()).throw(OSError('offline')))
        self.assertEqual(second.get('/media/catalog',query)['items'][0],item);self.assertEqual(second.get('/media/library',{})[0],item)
        second.save({'item':item,'action':'remove'});self.assertEqual(second.get('/media/library',{}),[])
    def test_source_preferences_persist_and_reenable_without_losing_other_choices(self):
        self.assertEqual(self.hub.get('/media/source-preferences',{}),{'disabledSourceIds':[]})
        self.hub.set_source_enabled({'id':'yts','enabled':False})
        self.hub.set_source_enabled({'id':'hydrahd','enabled':False})
        restarted=MediaHub(self.tmp.name)
        self.assertEqual(restarted.source_preferences()['disabledSourceIds'],['hydrahd','yts'])
        restarted.set_source_enabled({'id':'yts','enabled':True})
        self.assertEqual(self.hub.source_preferences()['disabledSourceIds'],['hydrahd'])
    def test_invalid_source_toggles_and_unavailable_sources_are_rejected(self):
        for value in [{'id':'../../etc/passwd','enabled':False},{'id':'yts','enabled':'false'},{'id':'missing','enabled':True},{}]:
            with self.assertRaises(ValueError):self.hub.set_source_enabled(value)
        blocked=next(x for x in self.hub.get('/media/source-registry',{})['sources'] if x['mode']=='unavailable')
        with self.assertRaises(ValueError):self.hub.set_source_enabled({'id':blocked['id'],'enabled':True})
        self.assertEqual(self.hub.source_preferences()['disabledSourceIds'],[])
    def test_failed_preference_write_keeps_saved_selection(self):
        self.hub.set_source_enabled({'id':'yts','enabled':False})
        with patch.object(Path,'write_text',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):self.hub.set_source_enabled({'id':'hydrahd','enabled':False})
        self.assertEqual(self.hub.source_preferences()['disabledSourceIds'],['yts'])

    def test_source_preference_http_endpoint_validates_origin_and_persists(self):
        import threading,urllib.request,urllib.error
        from http.server import ThreadingHTTPServer
        from translation_helper import Handler
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.media=self.hub
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        url='http://127.0.0.1:'+str(server.server_port)+'/media/source-preferences'
        def call(value=None,origin='app://-'):
            return urllib.request.urlopen(urllib.request.Request(url,data=json.dumps(value).encode() if value is not None else None,headers={'Origin':origin,'Content-Type':'application/json'}),timeout=2)
        with call({'id':'yts','enabled':False}) as r:
            self.assertEqual(r.headers['Access-Control-Allow-Origin'],'app://-');self.assertEqual(json.load(r)['disabledSourceIds'],['yts'])
        with call() as r:self.assertEqual(json.load(r)['disabledSourceIds'],['yts'])
        with self.assertRaises(urllib.error.HTTPError) as e:call({'id':'hydrahd','enabled':False},'https://evil.example')
        self.assertEqual(e.exception.code,403)
        with self.assertRaises(urllib.error.HTTPError) as e:call({'id':'yts','enabled':'false'})
        self.assertEqual(e.exception.code,400)
        self.assertEqual(self.hub.source_preferences()['disabledSourceIds'],['yts'])

    def test_json_in_html_decodes_without_evaluating_javascript(self):
        encoded=json.dumps([{'src':'https://suzaku.xin-cdn.xyz/test/master.m3u8','title':'مرحبا'}],ensure_ascii=True).replace('"',r'\u0022')
        doc=Page('<div x-data="'+__import__('html').escape("{video:JSON.parse('"+encoded+"'),bad:alert(1)}",quote=True)+'"></div>')
        self.assertEqual(doc.arrays[0][0]['title'],'مرحبا')
    def test_hydra_parser_deduplicates_cards_and_excludes_series_and_external_adverts(self):
        s='<a href="/movie/123-test"><img src="https://image.tmdb.org/t/p/w342/x.jpg" alt="Test"></a>'
        s+='<a href="https://evil.example/movie/xxx"><img src="https://evil.example/ad.jpg" alt="Ad"></a>'
        s+='<a href="/series/123-test"><img src="https://image.tmdb.org/x.jpg" alt="Series"></a>'
        self.assertEqual([a['title'] for a in hydra_items(s+s)],['Test'])
    def test_nyaa_feed_requires_real_infohash_and_ignores_bad_entries(self):
        s='<rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa"><channel><item><title>Test</title><nyaa:infoHash>'+'a'*40+'</nyaa:infoHash><nyaa:seeders>20</nyaa:seeders></item><item><title>Bad</title></item></channel></rss>'
        a=torrent_rss(s);self.assertEqual(len(a),1);self.assertEqual(a[0]['seeds'],'20');self.assertIn('magnet:',a[0]['magnet'])
    def test_source_ids_and_stream_proxy_cannot_reach_arbitrary_urls(self):
        for s in ['../secret','../../etc/passwd','https://evil.example','a?x=1']:
            with self.assertRaises(ValueError):id_part(s)
        for u in ['http://127.0.0.1/a','https://suzaku.xin-cdn.xyz.evil.example/a','https://user:pass@suzaku.xin-cdn.xyz/a','https://suzaku.xin-cdn.xyz:43211/a']:
            with self.assertRaises(ValueError):self.hub.proxy(u,'http://127.0.0.1:11435')
    def test_subtitles_convert_srt_timestamps_to_native_vtt(self):
        self.hub.fetcher=lambda *_:'1\n00:00:01,000 --> 00:00:02,500\nمرحبا\n'
        a=self.hub.get('/media/subtitle',{'url':['https://suzaku.xin-cdn.xyz/test/ar.srt']})
        self.assertTrue(a['vtt'].startswith('WEBVTT'));self.assertIn('00:00:02.500',a['vtt']);self.assertIn('مرحبا',a['vtt'])

    def test_electron_patch_fails_closed_and_retains_existing_external_link_behavior(self):
        needle='setWindowOpenHandler(({ frameName, url }) => {\n'
        result=patch_main((needle+'ORIGINAL').encode()).decode()
        self.assertEqual(result,needle+GUARD+'ORIGINAL')
        with self.assertRaises(ValueError):patch_main(b'changed upstream handler')

    def test_hls_proxy_rewrites_variant_audio_and_key_uris_to_local_requests(self):
        data=b'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/main.m3u8?token=x"\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"\nvideo/720.m3u8\n'
        class Response(io.BytesIO):
            status=200;headers={'Content-Type':'application/vnd.apple.mpegurl'}
            def geturl(self):return 'https://suzaku.xin-cdn.xyz/episode/master.m3u8'
        with patch('media_hub.R.urlopen',return_value=Response(data)):
            code,kind,body,_=self.hub.proxy('https://suzaku.xin-cdn.xyz/episode/master.m3u8','http://127.0.0.1:11435')
        self.assertEqual(code,200);self.assertEqual(kind,'application/vnd.apple.mpegurl');self.assertEqual(body.count(b'http://127.0.0.1:11435/media/proxy?url='),3)
        self.assertIn(b'%2Fkey.bin',body);self.assertIn(b'audio%2Fmain.m3u8%3Ftoken%3Dx',body)
    def test_source_captcha_is_rejected_instead_of_parsed_as_content(self):
        class Response(io.BytesIO):pass
        with patch('media_hub.R.urlopen',return_value=Response(b'<html><title>Just a moment</title><div class="cf-turnstile"></div></html>')):
            with self.assertRaisesRegex(ValueError,'requires verification'):fetch('https://anizone.to/anime')

if __name__=='__main__':unittest.main()


class SeriesDownloadTests(unittest.TestCase):
    def test_release_names(self):
        self.assertEqual(media_hub.release_episode('Show.S02E05.1080p'),{'season':2,'episode':5,'pack':False})
        self.assertEqual(media_hub.release_episode('Show S01-S03 Complete')['last'],3)
        self.assertTrue(media_hub.release_episode('Show Season 2 1080p')['pack'])
        self.assertEqual(media_hub.release_episode('Drama E07 720p')['episode'],7)
        self.assertIsNone(media_hub.release_episode('Show 1080p'))

    def test_dramaday_table(self):
        content='<table><tr><td>Episode</td><td>Quality</td><td>Download</td></tr><tr><td data-colspan="3">HDTV</td><td></td><td></td></tr><tr><td>01 </td><td>720p<br>540p</td><td><a href="https://dddrive.me/a">Google Drive</a> | <a href="https://ouo.io/b">MEGA</a><br><a href="https://cuty.io/c">Pixeldrain</a></td></tr></table>'
        posts=[{'slug':'my-drama','link':'https://dramaday.me/my-drama/','title':{'rendered':'My Drama'},'content':{'rendered':content}}]
        out=media_hub.dramaday_links(lambda url,*a:json.dumps(posts),'My Drama')
        self.assertEqual(out['episodes'],[{'label':'01','episode':1,'group':'HDTV','options':[{'quality':'720p','links':[{'host':'Google Drive','url':'https://dddrive.me/a'},{'host':'MEGA','url':'https://ouo.io/b'}]},{'quality':'540p','links':[{'host':'Pixeldrain','url':'https://cuty.io/c'}]}]}])
        self.assertEqual(media_hub.dramaday_links(lambda url,*a:json.dumps(posts),'Other Show')['episodes'],[])
