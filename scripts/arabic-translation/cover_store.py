"""Local cover choices, pinned offline images and Jikan/MAL gallery discovery."""
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import threading
import time
import urllib.request
from artwork_cache import validate_url


class CoverStore:
    def __init__(self, artwork, directory=None, fetch_json=None):
        self.artwork = artwork
        self.directory = Path(directory) if directory else artwork.directory.parent / 'cover-overrides'
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.gallery_lock = threading.Lock()
        self.fetch_json = fetch_json or self._fetch_gallery
        try:
            self.choices = json.loads((self.directory / 'choices.json').read_text())
        except (OSError, ValueError):
            self.choices = {}

    @staticmethod
    def _fetch_gallery(url):
        # Use only links explicitly marked as this title's picture gallery;
        # recommended titles and news thumbnails must never become choices.
        class Pictures(HTMLParser):
            def __init__(self): super().__init__(); self.urls = []
            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == 'a' and attrs.get('rel') == 'gallery-anime' and 'js-picture-gallery' in attrs.get('class', '').split():
                    self.urls.append(attrs.get('href'))
        mal_id = url.split('/')[-2]
        try:
            request = urllib.request.Request('https://myanimelist.net/anime/' + mal_id + '/_/pics', headers={'User-Agent': 'Mozilla/5.0 Seanime cover picker'})
            with urllib.request.urlopen(request, timeout=8) as response:
                data = response.read(2 * 1024 * 1024 + 1)
                if len(data) > 2 * 1024 * 1024: raise ValueError('Gallery too large')
            parser = Pictures(); parser.feed(data.decode('utf-8'))
            if parser.urls: return {'data': [{'jpg': {'large_image_url': item}} for item in parser.urls]}
        except Exception: pass
        return CoverStore._fetch_json(url)

    @staticmethod
    def _fetch_json(url):
        request = urllib.request.Request(url, headers={'User-Agent': 'Seanime cover picker', 'Accept': 'application/json'})
        with urllib.request.urlopen(request, timeout=8) as response:
            data = response.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024: raise ValueError('Gallery too large')
            return json.loads(data)

    @staticmethod
    def _id(value):
        value = str(value)
        if not value.isascii() or not value.isdigit() or not 0 < int(value) < 100000000: raise ValueError('Invalid media ID')
        return str(int(value))

    def manifest(self):
        with self.lock:
            return json.loads(json.dumps(self.choices))

    def options(self, mal_id):
        mal_id = self._id(mal_id)
        path = self.directory / ('options-' + mal_id + '.json')
        with self.gallery_lock:
            cached = None
            try:
                cached = json.loads(path.read_text())
                if time.time() - path.stat().st_mtime < 86400: return cached
            except (OSError, ValueError): pass
            try:
                response = self.fetch_json('https://api.jikan.moe/v4/anime/' + mal_id + '/pictures')
                urls = []
                for item in response.get('data', []):
                    url = item.get('jpg', {}).get('large_image_url') or item.get('jpg', {}).get('image_url')
                    try: validate_url(url)
                    except (ValueError, TypeError): continue
                    if url not in urls: urls.append(url)
                    if len(urls) >= 40: break
                self._write(path, urls)
                return urls
            except Exception:
                if cached is not None: return cached
                raise

    def choose(self, value):
        media_id = self._id(value.get('id', ''))
        kind = value.get('kind')
        with self.lock:
            old = self.choices.get(media_id)
            if kind == 'original':
                self.choices.pop(media_id, None)
            else:
                title = str(value.get('title') or 'Anime')[:180]
                originals = list(dict.fromkeys(value.get('originals') or []))[:8]
                for url in originals: validate_url(url)
                if not originals: raise ValueError('Original artwork is required')
                if kind == 'image':
                    source = value.get('source')
                    if source not in self.options(value.get('malId', '')): raise ValueError('Choose a gallery image')
                    data, mime, _ = self.artwork.get(source)
                elif kind == 'neutral':
                    source = None
                    words = title.split()
                    lines, line = [], ''
                    for word in words:
                        if len(line + ' ' + word) > 22 and line: lines.append(line); line = ''
                        line = (line + ' ' + word).strip()
                    if line: lines.append(line)
                    labels = ''.join('<text x="200" y="%d" text-anchor="middle" direction="auto">%s</text>' % (230 + i*38, html.escape(line)) for i,line in enumerate(lines[:6]))
                    data = ('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" fill="#191b2b"/><path d="M50 80h300M50 520h300" stroke="#7076b4" stroke-width="2"/><g fill="#eef0ff" font-family="sans-serif" font-size="25">'+labels+'</g></svg>').encode()
                    mime = 'image/svg+xml'
                else: raise ValueError('Invalid choice')
                version = hashlib.sha256(data).hexdigest()
                asset = self.directory / (version + '.cover')
                if not asset.exists():
                    temp = asset.with_suffix('.tmp'); temp.write_bytes(data); os.replace(temp, asset)
                self.choices[media_id] = {'kind':kind, 'title':title, 'source':source, 'originals':originals, 'version':version, 'mime':mime}
            try: self._write(self.directory / 'choices.json', self.choices)
            except Exception:
                if old: self.choices[media_id] = old
                else: self.choices.pop(media_id, None)
                raise
            if old and not any(item['version'] == old['version'] for item in self.choices.values()):
                try: (self.directory / (old['version'] + '.cover')).unlink()
                except OSError: pass
            return self.manifest()

    def image(self, media_id):
        with self.lock:
            choice = self.choices.get(self._id(media_id))
            if not choice: raise FileNotFoundError('No custom cover')
            return (self.directory / (choice['version'] + '.cover')).read_bytes(), choice['mime']

    @staticmethod
    def _write(path, value):
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(value, ensure_ascii=False))
        os.replace(temp, path)
