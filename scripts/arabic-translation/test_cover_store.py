import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from artwork_cache import ArtworkCache
from cover_store import CoverStore
from translation_helper import Handler
from test_artwork_cache import FakeSource, JPEG

URL = 'https://cdn.myanimelist.net/images/anime/1/2.jpg'
ORIGINAL = 'https://s4.anilist.co/cover.jpg'

class CoverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.source = FakeSource(); self.art = ArtworkCache(Path(self.tmp.name)/'images', self.source)
        self.calls = 0
        def gallery(url):
            self.calls += 1
            return {'data':[{'jpg':{'large_image_url':URL}},{'jpg':{'image_url':URL}},{'jpg':{'image_url':'https://evil.example/x'}}]}
        self.store = CoverStore(self.art, fetch_json=gallery)
        self.choice = {'id':123,'malId':456,'kind':'image','source':URL,'originals':[ORIGINAL],'title':'An anime'}

    def test_gallery_cached_deduplicated_and_filters_untrusted_hosts(self):
        self.assertEqual(self.store.options(456), [URL]); self.assertEqual(self.store.options(456), [URL]); self.assertEqual(self.calls, 1)
        path=self.store.directory/'options-456.json'; os.utime(path,(1,1))
        self.store.fetch_json=lambda _: (_ for _ in ()).throw(OSError('offline'))
        self.assertEqual(self.store.options(456), [URL])

    def test_selected_cover_pinned_after_general_cache_is_deleted_and_restart_offline(self):
        self.store.choose(self.choice)
        for path in self.art.directory.iterdir(): path.unlink()
        self.source.offline=True
        restarted=CoverStore(self.art)
        self.assertEqual(restarted.image(123),(JPEG,'image/jpeg'))
        self.assertEqual(restarted.manifest()['123']['source'],URL)

    def test_neutral_escapes_title_and_restoring_original_removes_override(self):
        self.store.choose({**self.choice,'kind':'neutral','title':'<script>& مرحبا'})
        data,mime=self.store.image(123)
        self.assertEqual(mime,'image/svg+xml'); self.assertIn(b'&lt;script&gt;&amp;',data); self.assertNotIn(b'<script>',data)
        self.assertEqual(self.store.choose({'id':123,'kind':'original'}),{})
        self.assertEqual(list(self.store.directory.glob('*.cover')),[])
        with self.assertRaises(FileNotFoundError):self.store.image(123)

    def test_invalid_or_non_gallery_images_cannot_replace_current_choice(self):
        self.store.choose({**self.choice,'kind':'neutral'}); before=self.store.manifest()
        for change in ({'source':ORIGINAL},{'id':'../123'},{'originals':['http://localhost/file']},{'kind':'upload'}):
            with self.assertRaises(ValueError):self.store.choose({**self.choice,**change})
            self.assertEqual(self.store.manifest(),before)

    def test_failed_manifest_write_keeps_previous_choice(self):
        self.store.choose({**self.choice,'kind':'neutral'});before=self.store.manifest()
        with patch.object(self.store,'_write',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):self.store.choose({'id':123,'kind':'original'})
        self.assertEqual(self.store.manifest(),before)

    def test_http_gallery_save_image_cors_and_reset(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.covers=self.store
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        base='http://127.0.0.1:'+str(server.server_port)
        def call(path,data=None,origin='app://-'):
            return urllib.request.urlopen(urllib.request.Request(base+path,data=json.dumps(data).encode() if data else None,headers={'Origin':origin,'Content-Type':'application/json'}),timeout=2)
        with call('/covers/options?malId=456') as r:self.assertEqual(json.load(r),{'images':[URL]})
        with call('/covers',self.choice) as r:self.assertEqual(r.headers['Access-Control-Allow-Origin'],'app://-');self.assertIn('123',json.load(r))
        with call('/covers/image?id=123') as r:self.assertEqual(r.read(),JPEG)
        with self.assertRaises(urllib.error.HTTPError) as e:call('/covers',self.choice,'https://evil.example')
        self.assertEqual(e.exception.code,403)
        with call('/covers',{'id':123,'kind':'original'}) as r:self.assertEqual(json.load(r),{})

if __name__=='__main__':unittest.main()
