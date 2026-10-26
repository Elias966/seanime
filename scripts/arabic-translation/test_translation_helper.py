import json
import threading
import unittest
import io
import time
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from translation_helper import Translator, needs_arabic_retry


def response(body):
    return {'choices': [{'message': {'content': json.dumps(body, ensure_ascii=False)}}]}


def payload(items):
    return {'model': 'test-model', 'messages': [{'role': 'user', 'content': json.dumps({
        'target_language': 'Arabic (ar)', 'request_id': 'request-1', 'items': items})}]}


class Tests(unittest.TestCase):
    def test_arabic_requirement_covers_single_words_and_all_scripts(self):
        self.assertTrue(needs_arabic_retry('We must leave now!', 'We must leave now!'))
        self.assertTrue(needs_arabic_retry('Naruto!', 'Naruto!'))
        self.assertTrue(needs_arabic_retry('こんにちは', 'こんにちは'))
        self.assertTrue(needs_arabic_retry('Привет', 'Привет'))
        self.assertTrue(needs_arabic_retry('Hello there', 'hello there أهلا'))
        self.assertFalse(needs_arabic_retry(r'{\fnRoboto}♪ 123 \N', '♪ 123'))
        self.assertFalse(needs_arabic_retry('We must leave now!', 'يجب أن نغادر الآن!'))

    def test_repair_missing_and_english_rows_without_repeating_good_rows(self):
        p = payload([{'id': 0, 'text': 'Good morning!'}, {'id': 1, 'text': 'We must go!'},
                     {'id': 2, 'text': 'Are you ready?'}])
        answers = [response({'request_id': 'request-1', 'translations': [
            {'id': 0, 'text': 'صباح الخير!'}, {'id': 1, 'text': 'We must go!'}]}),
            response({'translation': 'يجب أن نذهب!'}), response({'translation': 'هل أنت مستعد؟'})]
        t = Translator()
        with patch.object(t, 'complete', side_effect=answers) as call:
            out = t.translate(p)
        body = json.loads(out['choices'][0]['message']['content'])
        self.assertEqual([x['id'] for x in body['translations']], [0, 1, 2])
        self.assertEqual(body['translations'][0]['text'], 'صباح الخير!')
        self.assertEqual(body['request_id'], 'request-1')
        self.assertEqual(call.call_count, 3)
        self.assertEqual(call.call_args_list[1].args[0]['messages'][1]['content'], 'We must go!')
        self.assertEqual(call.call_args_list[2].args[0]['messages'][1]['content'], 'Are you ready?')

    def test_failed_retry_preserves_good_rows_instead_of_failing_whole_batch(self):
        t = Translator()
        with patch.object(t, 'complete', side_effect=[response({'translations': [
            {'id': 0, 'text': 'صباح الخير!'}, {'id': 1, 'text': 'We must go!'}]}),
            response({'translation': 'We must go!'}), response({'translation': 'We must go!'})]) as call:
            out = t.translate(payload([{'id': 0, 'text': 'Good morning!'}, {'id': 1, 'text': 'We must go!'}]))
        rows = json.loads(out['choices'][0]['message']['content'])['translations']
        self.assertEqual(rows[0]['text'], 'صباح الخير!')
        self.assertEqual(rows[1]['text'], 'We must go!')
        self.assertTrue(call.call_args_list[-1].kwargs['retry_reasoning'])

    def test_reasoning_retry_recovers_non_arabic_first_repair(self):
        t = Translator()
        with patch.object(t, 'complete', side_effect=[response({'translations': [{'id': 0, 'text': 'こんにちは'}]}),
            response({'translation': 'こんにちは'}), response({'translation': 'مرحبا'})]):
            out = t.translate(payload([{'id': 0, 'text': 'こんにちは'}]))
        self.assertEqual(json.loads(out['choices'][0]['message']['content'])['translations'][0]['text'], 'مرحبا')

    def test_malformed_initial_batch_can_be_repaired_by_line(self):
        t = Translator()
        with patch.object(t, 'complete', side_effect=[response('not an object'), response({'translation': 'مرحبا'})]):
            out = t.translate(payload([{'id': 0, 'text': 'Hello'}]))
        body = json.loads(out['choices'][0]['message']['content'])
        self.assertEqual(body['request_id'], 'request-1')
        self.assertEqual(body['translations'][0]['text'], 'مرحبا')

    def test_gemma_translates_one_source_per_prompt_and_preserves_partial_success(self):
        p = payload([{'id': 0, 'text': 'Hello'}, {'id': 1, 'text': 'We must go!'}, {'id': 2, 'text': 'こんにちは'}])
        p['model'] = 'gemma4:e2b'
        with patch.object(Translator, 'complete', side_effect=[response({'translation': 'مرحبا'}),
            response({'translation': 'We must go!'}), response({'translation': 'We must go!'}),
            response({'translation': 'أهلا'})]) as call:
            out = Translator().translate(p)
        rows = json.loads(out['choices'][0]['message']['content'])['translations']
        self.assertEqual([r['text'] for r in rows], ['مرحبا', 'We must go!', 'أهلا'])
        self.assertEqual([c.args[0]['messages'][1]['content'] for c in call.call_args_list],
                         ['Hello', 'We must go!', 'We must go!', 'こんにちは'])

    def test_stutter_is_normalized_only_for_a_failed_line_retry(self):
        t = Translator()
        with patch.object(t, 'complete', side_effect=[response({'translation': 'W-W-Why?'}), response({'translation': 'لماذا؟'})]) as call:
            out = t.retry_line({'model': 'gemma4:e2b'}, 'W-W-Why?', 999999999)
        self.assertEqual(out, 'لماذا؟')
        self.assertEqual(call.call_args_list[-1].args[0]['messages'][1]['content'], 'Why?')
        self.assertFalse(call.call_args_list[-1].kwargs['retry_reasoning'])

    def test_temporary_model_http_500_is_retried_before_falling_back(self):
        error = urllib.error.HTTPError('http://localhost/test', 500, 'temporary', {}, io.BytesIO(b''))
        mock_response = io.BytesIO(json.dumps(response({'translation': 'مرحبا'})).encode())
        with patch('translation_helper.urllib.request.urlopen', side_effect=[error, mock_response]) as call:
            out = Translator().complete({'model': 'gemma4:e2b'}, time.monotonic() + 5)
        self.assertEqual(call.call_count, 2)
        self.assertEqual(json.loads(out['choices'][0]['message']['content'])['translation'], 'مرحبا')

    def test_stutter_normalization_runs_even_when_first_prompt_causes_http_500(self):
        error = urllib.error.HTTPError('http://localhost/test', 500, 'prompt failure', {}, io.BytesIO(b''))
        with patch.object(Translator, 'complete', side_effect=[error, response({'translation': 'من هذا؟'})]) as call:
            out = Translator().retry_line({'model': 'gemma4:e2b'}, "Wh-wh-wh-wh-who's that?!", time.monotonic() + 10)
        self.assertEqual(out, 'من هذا؟')
        self.assertEqual(call.call_args_list[-1].args[0]['messages'][1]['content'], "who's that?!")

    def test_other_language_is_not_rewritten(self):
        p = payload([{'id': 0, 'text': 'Hello there'}])
        p['messages'][0]['content'] = p['messages'][0]['content'].replace('Arabic (ar)', 'French (fr)')
        answer = response({'translations': [{'id': 0, 'text': 'Bonjour'}]})
        with patch.object(Translator, 'complete', return_value=answer):
            self.assertEqual(Translator().translate(p), answer)

    def test_http_request_disables_thinking(self):
        captured = []
        class FakeOllama(BaseHTTPRequestHandler):
            def do_POST(self):
                captured.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                data = json.dumps(response({'translations': [{'id': 0, 'text': 'صباح الخير!'}]})).encode()
                self.send_response(200); self.send_header('Content-Length', str(len(data)))
                self.end_headers(); self.wfile.write(data)
            def log_message(self, *args): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), FakeOllama)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            p = payload([{'id': 0, 'text': 'Good morning!'}]); p['reasoning_effort'] = 'high'
            Translator('http://127.0.0.1:' + str(server.server_port)).translate(p)
            self.assertEqual(captured[0]['reasoning_effort'], 'none')
            self.assertFalse(captured[0]['stream'])
            self.assertEqual(p['reasoning_effort'], 'high')
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
