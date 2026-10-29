"""Persistent public artwork cache for local Seanime libraries. GPL-3.0.

No credentials are forwarded; only explicitly supported HTTPS artwork CDNs may
be fetched. Cache hits require no DNS lookup or outbound request.
"""
import hashlib
import json
import os
from pathlib import Path
import threading
import time
import urllib.parse
import urllib.request

ALLOWED_HOSTS = frozenset(('s4.anilist.co', 's.anilist.co', 'artworks.thetvdb.com',
                          'image.tmdb.org', 'cdn.myanimelist.net', 'i.ytimg.com', 'yts.gg', 'img.yts.gg', 'yts.lt', 'img.yts.lt', 'anizone.to'))
MAX_IMAGE = 8 * 1024 * 1024
MAX_CACHE = 512 * 1024 * 1024


def validate_url(url):
    parts = urllib.parse.urlsplit(url)
    if (parts.scheme != 'https' or parts.hostname not in ALLOWED_HOSTS or
            parts.username is not None or parts.password is not None or
            parts.port not in (None, 443) or not parts.path or parts.fragment):
        raise ValueError('Unsupported artwork URL')
    return url


def image_type(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'): return 'image/png'
    if data.startswith(b'\xff\xd8\xff'): return 'image/jpeg'
    if data[:6] in (b'GIF87a', b'GIF89a'): return 'image/gif'
    if data.startswith(b'RIFF') and data[8:12] == b'WEBP': return 'image/webp'
    if data[4:8] == b'ftyp' and any(x in data[8:40] for x in (b'avif', b'avis')): return 'image/avif'
    raise ValueError('Unsupported image data')


class ArtworkRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        validate_url(url)
        return super().redirect_request(request, fp, code, message, headers, url)


class ArtworkCache:
    def __init__(self, directory=None, opener=None, max_bytes=MAX_CACHE):
        self.directory = Path(directory) if directory else Path(os.environ.get(
            'XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'seanime/artwork-cache'
        self.directory.mkdir(parents=True, exist_ok=True)
        self.opener = opener or urllib.request.build_opener(ArtworkRedirect())
        self.gate = threading.BoundedSemaphore(4)
        self.locks = [threading.Lock() for _ in range(64)]
        self.max_bytes = max_bytes
        self.prune_lock = threading.Lock()
        self.last_prune = 0
        self.known_size = sum(path.stat().st_size for path in self.directory.glob('*.img'))
        self.bytes_since_prune = 0

    def get(self, url):
        validate_url(url)
        key = hashlib.sha256(url.encode()).hexdigest()
        path = self.directory / (key + '.img')
        with self.locks[int(key[:4], 16) % len(self.locks)]:
            try:
                data = path.read_bytes()
                kind = image_type(data)
                os.utime(path, None)
                return data, kind, True
            except (FileNotFoundError, ValueError):
                pass
            if not self.gate.acquire(timeout=20):
                raise TimeoutError('Artwork cache busy')
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'Seanime artwork cache',
                                                               'Accept': 'image/avif,image/webp,image/*'})
                with self.opener.open(request, timeout=15) as response:
                    validate_url(response.geturl())
                    data = response.read(MAX_IMAGE + 1)
                if not data or len(data) > MAX_IMAGE:
                    raise ValueError('Artwork exceeds size limit')
                kind = image_type(data)
                temporary = path.with_suffix('.tmp')
                temporary.write_bytes(data)
                temporary.replace(path)
            finally:
                self.gate.release()
        self.prune(keep=path, added_bytes=len(data))
        return data, kind, False

    def prune(self, keep, added_bytes=0):
        with self.prune_lock:
            self.bytes_since_prune += added_bytes
            if time.monotonic() - self.last_prune < 30 and self.known_size + self.bytes_since_prune <= self.max_bytes:
                return
            self.last_prune = time.monotonic()
            files = sorted(self.directory.glob('*.img'), key=lambda p: p.stat().st_mtime)
            total = sum(p.stat().st_size for p in files)
            for path in files:
                if total <= self.max_bytes: break
                if path == keep: continue
                size = path.stat().st_size
                try:
                    path.unlink()
                    total -= size
                except FileNotFoundError:
                    pass
            self.known_size = total
            self.bytes_since_prune = 0
