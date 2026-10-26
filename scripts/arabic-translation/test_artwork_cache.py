import concurrent.futures
import io
import tempfile
import unittest
from artwork_cache import ArtworkCache, validate_url, MAX_IMAGE

URL = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/test.jpg'
JPEG = b'\xff\xd8\xff' + b'fake raster fixture'


class Response(io.BytesIO):
    def geturl(self): return URL


class FakeSource:
    def __init__(self, content=JPEG): self.content = content; self.calls = 0; self.offline = False
    def open(self, request, timeout):
        self.calls += 1
        if self.offline: raise OSError('network unavailable')
        return Response(self.content)


class ArtworkTests(unittest.TestCase):
    def test_persists_and_loads_offline_after_process_restart_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            source = FakeSource()
            first = ArtworkCache(folder, source)
            self.assertEqual(first.get(URL), (JPEG, 'image/jpeg', False))
            source.offline = True
            second = ArtworkCache(folder, source)
            self.assertEqual(second.get(URL), (JPEG, 'image/jpeg', True))
            self.assertEqual(source.calls, 1)

    def test_concurrent_duplicate_urls_fetch_once(self):
        with tempfile.TemporaryDirectory() as folder:
            source = FakeSource(); cache = ArtworkCache(folder, source)
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(cache.get, [URL] * 8))
            self.assertEqual(source.calls, 1)
            self.assertTrue(all(result[0] == JPEG for result in results))

    def test_blocks_non_artwork_hosts_credentials_non_https_and_custom_ports(self):
        for url in ('http://s4.anilist.co/test.jpg', 'https://127.0.0.1/test.jpg',
                    'https://s4.anilist.co.evil.example/a', 'https://user:pass@s4.anilist.co/a',
                    'https://s4.anilist.co:43211/a', 'file:///etc/passwd'):
            with self.assertRaises(ValueError): validate_url(url)

    def test_html_svg_and_oversized_responses_are_not_cached(self):
        for content in (b'<html>temporary error</html>', b'<svg onload="bad"/>', b'\xff\xd8\xff' + b'x' * MAX_IMAGE):
            with tempfile.TemporaryDirectory() as folder:
                source = FakeSource(content); cache = ArtworkCache(folder, source)
                with self.assertRaises(ValueError): cache.get(URL)
                self.assertEqual(list(cache.directory.glob('*.img')), [])

    def test_redirect_cannot_leave_supported_artwork_hosts(self):
        from artwork_cache import ArtworkRedirect
        import urllib.request
        redirect = ArtworkRedirect()
        with self.assertRaises(ValueError):
            redirect.redirect_request(urllib.request.Request(URL), None, 302, 'Found', {}, 'http://127.0.0.1/admin')

    def test_quota_keeps_latest_image_and_evicts_older(self):
        with tempfile.TemporaryDirectory() as folder:
            source = FakeSource(); cache = ArtworkCache(folder, source, max_bytes=len(JPEG) + 1)
            cache.get(URL)
            cache.get(URL + '?new=1')
            self.assertEqual(len(list(cache.directory.glob('*.img'))), 1)
            self.assertTrue(cache.get(URL + '?new=1')[2])
