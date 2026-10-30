#!/usr/bin/env python3
"""Bounded, cached homepage audit. This never asserts playback support.

Run: python3 scripts/media-hub/audit_sources.py [--refresh] [--cache-dir PATH]
Only --refresh repeats network requests. No browser challenges are solved.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import gzip
import json
import re
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent

class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(); self.hidden = 0; self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.hidden += 1
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.hidden = max(0, self.hidden - 1)
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)

def classify(html, code=200, url=''):
    parser = VisibleText(); parser.feed(html)
    visible = re.sub(r'\s+', ' ', ' '.join(parser.parts)).lower()
    # Passive Cloudflare scripts, Turnstile libraries, and CAPTCHA widgets in
    # comments do not establish a verification wall. Require visible wall text.
    walls = ('verify you are human', 'verify that you are human', 'verifying you are human',
             'complete the captcha', 'please complete the security check',
             'checking your browser before accessing', 'performing security verification',
             'enable javascript and cookies to continue', 'checking if the site connection is secure',
             'security verification required', 'please wait while we verify')
    if any(x in visible for x in walls) or ('just a moment' in visible and code in (403, 503)):
        return 'verification-wall', 'Explicit browser/human verification wall; excluded without bypass.'
    if any(x in visible for x in ('this domain is for sale', 'buy this domain', 'domain has expired',
                                  'domain is parked', 'website is for sale', 'sedo domain parking')):
        return 'unrelated', 'Parked, expired, or for-sale domain.'
    if any(x in visible for x in ('service discontinued', 'operations have been permanently terminated', 'website will gradually close its old way of operating')):
        return 'unavailable', 'Homepage announces closure or discontinued operations.'
    if re.search(r'window\.location\.href\s*=\s*[\"\']/lander[\"\']', html) and len(visible.strip()) < 8:
        return 'unrelated', 'Only a redirect to a domain lander remains; no media page was found.'
    if code >= 400:
        return 'unavailable', 'HTTP %s; page access failed.' % code
    if len(visible.strip()) < 8 and not re.search(r'<(?:script|iframe)\b', html, re.I):
        return 'unavailable', 'Empty or unusable response.'
    if any(x in visible for x in ('sign up required', 'registration required to download',
                                  'you must be logged in to download', 'login required to download')):
        return 'account-required', 'Page explicitly requires an account for downloads.'
    if any(x in url for x in ('proxymirrorlookmovie.github.io', 'eztvstatus.org', 'hydrahd.info', 'reindex.to')):
        return 'directory', 'Listed mirror/status directory; homepage only.'
    return 'reachable', 'Homepage reachable; media playback/download was not tested.'

def probe(url, cache_dir, refresh=False):
    key = hashlib.sha256(url.encode()).hexdigest()
    cache = cache_dir / (key + '.json')
    if cache.exists() and not refresh:
        result = json.loads(cache.read_text())
        evidence = cache_dir / (key + '.html')
        if evidence.exists() and result.get('httpStatus'):
            html = evidence.read_text()
            result['status'], result['reason'] = classify(html, result['httpStatus'], result.get('finalUrl', url))
        return result
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result = {'url': url, 'checkedAt': now, 'level': 'reachable-page'}
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml'})
    try:
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            body = response.read(750000)
            if body.startswith(b'\x1f\x8b'):
                body = gzip.decompress(body)[:2000000]
            html = body.decode('utf-8', errors='replace')
            result.update(httpStatus=response.code, finalUrl=response.geturl(), bytesRead=len(body))
            result['status'], result['reason'] = classify(html, response.code, response.geturl())
            title = re.search(r'<title[^>]*>(.*?)</title>', html, re.I | re.S)
            if title: result['title'] = re.sub(r'\s+', ' ', title.group(1)).strip()[:250]
            # Save evidence to permit reviewing classifications without re-probing.
            (cache_dir / (key + '.html')).write_text(html)
    except Exception as exc:
        result.update(status='unavailable', reason=type(exc).__name__ + ': ' + str(exc)[:250])
    cache.write_text(json.dumps(result, indent=2) + '\n')
    return result

def apply_audit(source, probes):
    source['audit'] = {'level': 'reachable-page', 'playbackTested': False, 'probes': probes,
                       'checkedAt': max(p['checkedAt'] for p in probes)}
    usable = [p for p in probes if p['status'] in ('reachable', 'available')]
    account = [p for p in probes if p['status'] == 'account-required']
    directories = [p for p in probes if p['status'] == 'directory']
    selected = (usable or account or directories or probes)[0]
    # Account requirements explicitly documented by the source list are retained,
    # even if the public landing page itself can be fetched without an account.
    if source.get('accountRequired') and usable:
        source['status'] = 'account-required'
        source['reason'] = 'Source list explicitly documents required sign-up; homepage reachable.'
    else:
        source['status'], source['reason'] = selected['status'], selected['reason']
    source['audit']['selectedUrl'] = selected['url']
    source['browseUrl'] = selected['url']
    source['mode'] = ('native' if source.get('nativeId') else 'site') if source['status'] in ('reachable', 'available', 'account-required', 'directory') else 'unavailable'
    if source['status'] == 'verification-wall':
        source['mode'] = 'firefox'
    source['excluded'] = source['mode'] == 'unavailable'
    return source

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--cache-dir', type=Path, default=ROOT.parents[2] / 'all-sources' / 'probes')
    ap.add_argument('--catalog', type=Path, default=ROOT / 'sources.json')
    args = ap.parse_args(); args.cache_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads(args.catalog.read_text())
    urls = list(dict.fromkeys(u for s in data['sources'] for u in [s['url']] + s['alternateUrls']))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda u: probe(u, args.cache_dir, args.refresh), urls))
    for result in results:
        if result['status'] == 'available': result['status'] = 'reachable'
    by_url = {p['url']: p for p in results}
    for source in data['sources']:
        apply_audit(source, [by_url[u] for u in [source['url']] + source['alternateUrls']])
    data['auditedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    data['auditLevel'] = 'reachable-page'
    data['counts'] = {status: sum(s['status'] == status for s in data['sources']) for status in sorted({s['status'] for s in data['sources']})}
    args.catalog.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'sources':len(data['sources']), 'urls':len(urls), 'statuses':data['counts']}))

if __name__ == '__main__': main()
