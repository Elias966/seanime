#!/usr/bin/env python3
"""Local Seanime/Ollama adapter: no reasoning, retry incomplete Arabic translations.

Python standard library only. Binds loopback; all model requests stay on loopback.
"""
import argparse
import copy
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
import unicodedata
import urllib.parse
from artwork_cache import ArtworkCache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HELPER_REVISION = 'arabic-phrases-v6'
LOG = logging.getLogger('seanime-translation')
ARABIC = re.compile(r'[\u0620-\u064a\u066e-\u06d3\u06fa-\u06ff\u0750-\u077f\u08a0-\u08c9]')
LATIN_WORDS = re.compile(r'[A-Za-z]+')


def clean_dialogue(text):
    text = re.sub(r'\{[^}]*\}|<[^>]*>', '', text or '')
    return re.sub(r'\\[Nnh]', ' ', text).strip()


def needs_arabic_retry(source, translated):
    # Model replies are plain dialogue, never ASS/TeX/HTML instructions. Do not
    # let cleanup hide broken output from validation (e.g. Arabic + "ext{...").
    raw = translated or ''
    if (re.search(r'[{}]|<[^>]*>|\\[A-Za-z]+', raw) or
            any(unicodedata.category(c) in ('Co', 'Cs') or c == '\ufffd' for c in raw)):
        return True
    source, translated = clean_dialogue(source), clean_dialogue(translated)
    source_letters = [c for c in source if unicodedata.category(c).startswith('L')]
    letters = [c for c in translated if unicodedata.category(c).startswith('L')]
    arabic = sum(bool(ARABIC.fullmatch(c)) for c in letters)
    if not source_letters:
        return False  # Numbers, punctuation, music markers and ASS formatting.
    if not letters or not arabic:
        return True  # Includes single English words, Japanese, Cyrillic, etc.
    foreign = len(letters) - arabic
    foreign_words = re.findall(r'[A-Za-z]+', translated)
    other_script = any(ord(c) > 127 and not ARABIC.fullmatch(c) for c in letters)
    return other_script or (foreign >= 4 and arabic / len(letters) < .75) or len(foreign_words) >= 2


def source_payload(payload):
    for message in reversed(payload.get('messages', [])):
        if message.get('role') == 'user':
            try:
                return json.loads(message['content'])
            except (ValueError, TypeError, KeyError):
                return None
    return None


class Translator:
    def __init__(self, upstream='http://127.0.0.1:11434'):
        self.upstream = upstream.rstrip('/')
        self.gate = threading.Semaphore(1)

    def complete(self, payload, deadline, *, retry_reasoning=False):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Translation deadline exceeded')
        outgoing = copy.deepcopy(payload)
        outgoing['reasoning_effort'] = 'low' if retry_reasoning else 'none'
        outgoing['stream'] = False
        data = json.dumps(outgoing, ensure_ascii=False).encode()
        request = urllib.request.Request(self.upstream + '/v1/chat/completions', data=data,
                                         headers={'Content-Type': 'application/json'})
        # Ollama already has one generation slot here. Serializing avoids flooding it.
        if not self.gate.acquire(timeout=max(0.01, deadline - time.monotonic())):
            raise TimeoutError('Timed out waiting for the local model')
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Translation deadline exceeded')
            for attempt in range(3):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('Translation deadline exceeded')
                try:
                    with urllib.request.urlopen(request, timeout=remaining) as response:
                        return json.load(response)
                except urllib.error.HTTPError as error:
                    if error.code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                        raise
                    LOG.warning('Retrying local model HTTP %d (attempt %d)', error.code, attempt + 1)
                    error.close()
                except (urllib.error.URLError, TimeoutError):
                    if attempt == 2 or deadline - time.monotonic() < .3:
                        raise
                    LOG.warning('Retrying temporary local model transport failure (attempt %d)', attempt + 1)
                time.sleep(min(.15 * (2 ** attempt), max(0, deadline - time.monotonic())))

        finally:
            self.gate.release()

    def retry_line(self, original_payload, source, deadline):
        payload = {
            'model': original_payload['model'], 'temperature': 0, 'stream': False,
            'messages': [
                {'role': 'system', 'content': 'Translate this subtitle into natural Modern Standard Arabic. Translate the complete sentence and preserve its subject and tense. Karaoke may split words into syllables with spaces: reconstruct the original words before translating (for example "gif ted" means "gifted" and "be ing" means "being"). Render names in Arabic script too. Translate English, Japanese, Chinese, Cyrillic and any other source language completely into Arabic; do not copy foreign dialogue or add explanations. Return JSON only: {"translation":"Arabic translation"}.'},
                {'role': 'user', 'content': source},
            ],
            'response_format': {'type': 'json_schema', 'json_schema': {
                'name': 'arabic_subtitle_retry', 'schema': {
                    'type': 'object', 'properties': {'translation': {'type': 'string'}},
                    'required': ['translation'], 'additionalProperties': False,
                }}},
        }
        # A second, reasoning-enabled attempt is reserved for actual failures.
        for attempt in range(2):
            normalized = re.sub(r'\b(?:[A-Za-z]{1,3}-){2,}', '', source) if attempt else source
            payload['messages'][1]['content'] = normalized
            try:
                response = (self.complete(payload, deadline) if attempt == 0 else
                            self.complete(payload, deadline, retry_reasoning=(normalized == source)))
                text = json.loads(response['choices'][0]['message']['content'])['translation']
                if isinstance(text, str) and text.strip() and not needs_arabic_retry(source, text):
                    return text
            except urllib.error.HTTPError as error:
                if error.code not in (408, 429, 500, 502, 503, 504):
                    raise
                error.close()
            except (ValueError, KeyError, TypeError, IndexError):
                pass
        raise ValueError('Model still returned an untranslated or mixed-language subtitle')

    def translate(self, payload):
        started = time.monotonic()
        deadline = started + 50  # Seanime's event batch has a 60-second deadline.
        src = source_payload(payload)
        target = str(src.get('target_language', '')).lower() if isinstance(src, dict) else ''
        arabic_request = target == 'ar' or target.startswith('ar-') or target.startswith('arabic')
        if not arabic_request:
            return self.complete(payload, deadline)
        # Never discard successful rows because another row's repair failed.
        try:
            if str(payload.get('model', '')).lower().startswith('gemma4'):
                # Gemma can return fluent but unrelated Arabic in batched JSON.
                # One source line per prompt avoids cross-item alignment failures.
                response = {'choices': [{'message': {'role': 'assistant', 'content': ''}, 'finish_reason': 'stop'}]}
                body = {}
            else:
                response = self.complete(payload, deadline)
                body = json.loads(response['choices'][0]['message']['content'])
        except Exception:
            response = {'choices': [{'message': {'role': 'assistant', 'content': ''}, 'finish_reason': 'stop'}]}
            body = {}
        if not isinstance(body, dict):
            body = {}
        repairs, failed = 0, 0

        def repair(source):
            nonlocal repairs, failed
            try:
                translated = self.retry_line(payload, source, deadline)
                repairs += 1
                return translated
            except Exception as error:
                # Preserve only this source line; the UI must mark it incomplete.
                failed += 1
                LOG.warning('Line repair failed: %s', type(error).__name__)
                return source

        if isinstance(src.get('items'), list):
            rows = body.get('translations', [])
            if not isinstance(rows, list):
                rows = []
            by_id = {x['id']: x for x in rows if isinstance(x, dict) and
                     type(x.get('id')) is int and isinstance(x.get('text'), str)}
            rebuilt = []
            for item in src['items']:
                item_id, source = item['id'], item['text']
                row = by_id.get(item_id)
                if row is None or not row['text'].strip() or needs_arabic_retry(source, row['text']):
                    row = {'id': item_id, 'text': repair(source)}
                rebuilt.append(row)
            body = {'translations': rebuilt}
        elif isinstance(src.get('text'), str):
            text = body.get('translation')
            if not isinstance(text, str) or not text.strip() or needs_arabic_retry(src['text'], text):
                text = repair(src['text'])
            body = {'translation': text}
        else:
            return response
        if src.get('request_id'):
            body['request_id'] = src['request_id']
        response['choices'][0]['message']['content'] = json.dumps(body, ensure_ascii=False)
        # No subtitle text is written to logs.
        LOG.info('processed in %.2fs; repaired lines=%d; untranslated lines=%d',
                 time.monotonic() - started, repairs, failed)
        return response


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def send_json(self, status, payload, *, cors=False):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        if cors:
            self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path == '/images':
            try:
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                url = query.get('url', [''])[0]
                data, kind, cached = self.server.artwork.get(url)
                self.send_response(200)
                self.send_header('Content-Type', kind)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'private, max-age=31536000, immutable')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('X-Seanime-Artwork-Cache', 'hit' if cached else 'stored')
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except ValueError:
                self.send_json(400, {'error': {'message': 'Unsupported artwork'}})
            except Exception:
                self.send_json(502, {'error': {'message': 'Artwork not cached and source unavailable'}})
            return
        if self.path in ('/health', '/healthz'):
            return self.send_json(200, {'ok': True, 'revision': HELPER_REVISION}, cors=True)
        if self.path.rstrip('/') == '/v1/models':
            try:
                with urllib.request.urlopen(self.server.translator.upstream + '/v1/models', timeout=5) as r:
                    return self.send_json(200, json.load(r))
            except Exception:
                return self.send_json(502, {'error': {'message': 'Local Ollama unavailable'}})
        self.send_json(404, {'error': {'message': 'Unknown endpoint'}})

    def do_POST(self):
        if self.path.rstrip('/') != '/v1/chat/completions':
            return self.send_json(404, {'error': {'message': 'Unknown endpoint'}})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2 * 1024 * 1024:
                return self.send_json(413, {'error': {'message': 'Invalid request size'}})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or not payload.get('model'):
                return self.send_json(400, {'error': {'message': 'Model is required'}})
            self.send_json(200, self.server.translator.translate(payload))
        except (BrokenPipeError, ConnectionResetError):
            LOG.warning('Client disconnected')
        except Exception as error:
            LOG.warning('Translation failed: %s', type(error).__name__)
            try:
                self.send_json(502, {'error': {'message': 'Local subtitle translation failed; see helper service log'}})
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, *_args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=11435)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.daemon_threads = True
    server.translator = Translator()
    server.artwork = ArtworkCache()
    LOG.info('Listening on 127.0.0.1:%d; local Ollama adapter and persistent artwork cache', args.port)
    server.serve_forever()


if __name__ == '__main__':
    main()
