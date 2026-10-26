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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = logging.getLogger('seanime-translation')
ARABIC = re.compile(r'[\u0620-\u064a\u066e-\u06d3\u06fa-\u06ff\u0750-\u077f\u08a0-\u08c9]')
LATIN_WORDS = re.compile(r'[A-Za-z]+')


def needs_arabic_retry(source, translated):
    # Single names, interjections and punctuation can legitimately stay unchanged.
    # A sentence of two or more Latin words with no Arabic is a useful conservative signal.
    return (len(LATIN_WORDS.findall(source)) >= 2 and
            not ARABIC.search(translated) and len(LATIN_WORDS.findall(translated)) >= 2)


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

    def complete(self, payload, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Translation deadline exceeded')
        outgoing = copy.deepcopy(payload)
        outgoing['reasoning_effort'] = 'none'
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
            with urllib.request.urlopen(request, timeout=remaining) as response:
                return json.load(response)
        finally:
            self.gate.release()

    def retry_line(self, original_payload, source, deadline):
        payload = {
            'model': original_payload['model'], 'temperature': 0, 'stream': False,
            'messages': [
                {'role': 'system', 'content': 'Translate this subtitle into natural Modern Standard Arabic. Translate the complete sentence. Preserve names, but do not leave English sentences untranslated. Return JSON only: {"translation":"Arabic translation"}.'},
                {'role': 'user', 'content': source},
            ],
            'response_format': {'type': 'json_schema', 'json_schema': {
                'name': 'arabic_subtitle_retry', 'schema': {
                    'type': 'object', 'properties': {'translation': {'type': 'string'}},
                    'required': ['translation'], 'additionalProperties': False,
                }}},
        }
        response = self.complete(payload, deadline)
        text = json.loads(response['choices'][0]['message']['content'])['translation']
        if not isinstance(text, str) or not text.strip() or needs_arabic_retry(source, text):
            raise ValueError('Model still returned an untranslated Arabic subtitle')
        return text

    def translate(self, payload):
        started = time.monotonic()
        deadline = started + 50  # Seanime's event batch has a 60-second deadline.
        response = self.complete(payload, deadline)
        src = source_payload(payload)
        if not isinstance(src, dict):
            return response
        target = str(src.get('target_language', '')).lower()
        if target != 'ar' and not target.startswith('arabic'):
            return response
        try:
            body = json.loads(response['choices'][0]['message']['content'])
        except (ValueError, TypeError, KeyError, IndexError):
            # Seanime retains its own malformed-response retry logic.
            return response
        repairs = 0
        if isinstance(body, dict) and isinstance(src.get('items'), list):
            rows = body.get('translations')
            if not isinstance(rows, list):
                return response
            by_id = {x['id']: x for x in rows if isinstance(x, dict) and
                     type(x.get('id')) is int and isinstance(x.get('text'), str)}
            rebuilt = []
            for item in src['items']:
                item_id, source = item['id'], item['text']
                row = by_id.get(item_id)
                if row is None or not row['text'].strip() or needs_arabic_retry(source, row['text']):
                    row = {'id': item_id, 'text': self.retry_line(payload, source, deadline)}
                    repairs += 1
                rebuilt.append(row)
            body['translations'] = rebuilt
        elif isinstance(body, dict) and isinstance(src.get('text'), str):
            text = body.get('translation')
            if not isinstance(text, str) or not text.strip() or needs_arabic_retry(src['text'], text):
                body['translation'] = self.retry_line(payload, src['text'], deadline)
                repairs += 1
        response['choices'][0]['message']['content'] = json.dumps(body, ensure_ascii=False)
        # No subtitle text is written to logs.
        LOG.info('completed in %.2fs; repaired lines=%d', time.monotonic() - started, repairs)
        return response


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ('/health', '/healthz'):
            return self.send_json(200, {'ok': True})
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
    LOG.info('Listening on 127.0.0.1:%d; forwarding only to local Ollama', args.port)
    server.serve_forever()


if __name__ == '__main__':
    main()
