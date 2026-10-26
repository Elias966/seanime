const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(__dirname + '/../../seanime-web/public/translation-progress.js', 'utf8'), context);
const { Progress } = context.module.exports;
const settings = { mediaPlayer: { vcTranslate: true, vcTranslateTargetLanguage: 'ar' } };
const event = (type, payload) => ({ type: 'videocore', payload: { type, payload } });
function tracker() { const t = new Progress(); t.settings(settings); return t; }
test('counts queued work from English and Japanese, not imaginary episode totals', () => {
    const t = tracker();
    t.outgoing(event('translate-text', { text: 'Good morning' }), 100);
    t.outgoing(event('translate-text', { text: 'こんにちは' }), 100);
    t.incoming(event('translated-text', { original: 'こんにちは', translated: 'مرحبا' }), 200);
    let s = t.snapshot(300);
    assert.equal(s.total, 2); assert.equal(s.processed, 1); assert.equal(s.pending, 1); assert.equal(s.percent, 50);
    assert.equal(s.arabic, 1); assert.ok(s.visible);
});
test('unchanged English does not count as Arabic success', () => {
    const t = tracker(); t.outgoing(event('translate-text', { text: 'We must go' }), 100);
    t.incoming(event('translated-text', { original: 'We must go', translated: 'We must go' }), 200);
    assert.equal(t.snapshot(300).arabic, 0); assert.equal(t.snapshot(300).unchanged, 1);
    assert.equal(t.snapshot(300).status, 'incomplete'); assert.equal(t.snapshot(300).percent, 0);
});
test('repeated dialogue, duplicate results, and late timeout recovery', () => {
    const t = tracker();
    for (let n = 0; n < 2; n++) t.outgoing(event('translate-text', { text: 'Hello' }), 100);
    t.incoming(event('translated-text', { original: 'Hello', translated: 'مرحبا' }), 200);
    assert.equal(t.snapshot(80000).timeout, 1);
    t.incoming(event('translated-text', { original: 'Hello', translated: 'مرحبا' }), 81000);
    t.incoming(event('translated-text', { original: 'Hello', translated: 'مرحبا' }), 82000);
    assert.equal(t.snapshot(82000).arabic, 2); assert.equal(t.snapshot(82000).timeout, 0);
});
test('whole file is indeterminate until a matching translated file arrives', () => {
    const t = tracker(); t.outgoing(event('translate-subtitle-file-track', { index: 4 }), 100);
    assert.equal(t.snapshot(200).percent, null); assert.equal(t.snapshot(200).filePending, 1);
    t.incoming(event('add-external-subtitle-track', { index: 5, label: '(translated)', content: 'مرحبا' }), 300);
    assert.equal(t.snapshot(300).filePending, 1);
    t.incoming(event('add-external-subtitle-track', { index: 4, label: '(translated)', content: 'مرحبا' }), 400);
    assert.equal(t.snapshot(500).filePending, 0); assert.equal(t.snapshot(500).active, false);
    assert.equal(t.snapshot(11000).visible, false);
});
test('file returned in original language is reported without a success claim', () => {
    const t = tracker(); t.outgoing(event('translate-subtitle-file-track', { index: 4 }), 100);
    t.incoming(event('add-external-subtitle-track', { index: 4, label: '(translated)', content: 'Hello world' }), 200);
    assert.equal(t.snapshot(300).fileUnchanged, 1);
});
test('settings race preserves early queued lines and new episode resets counters', () => {
    const t = new Progress(); t.outgoing(event('translate-text', { text: 'Hello' }), 100);
    t.settings(settings); assert.equal(t.snapshot(200).total, 1);
    t.outgoing(event('video-loaded', {}), 300); assert.equal(t.snapshot(300).total, 0);
    t.outgoing(event('translate-text', { text: 'Next episode' }), 400);
    t.settings({ mediaPlayer: { vcTranslate: true, vcTranslateTargetLanguage: 'fr' } });
    assert.equal(t.snapshot(500).total, 0); assert.equal(t.snapshot(500).visible, false);
});

test('one Arabic line cannot mark an otherwise English file complete', () => {
    const t = tracker(); t.outgoing(event('translate-subtitle-file-track', { index: 4 }), 100);
    const content = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,مرحبا\nDialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,Good morning';
    t.incoming(event('add-external-subtitle-track', { index: 4, label: '(translated)', content }), 200);
    const s = t.snapshot(300); assert.equal(s.total, 2); assert.equal(s.arabic, 1);
    assert.equal(s.unchanged, 1); assert.equal(s.percent, 50); assert.equal(s.status, 'incomplete');
});
test('mixed language and unknown file payloads cannot show success', () => {
    const t = tracker(); t.outgoing(event('translate-text', { text: 'Hello there' }), 100);
    t.incoming(event('translated-text', { original: 'Hello there', translated: 'hello there أهلا' }), 200);
    assert.equal(t.snapshot(300).mixed, 1); assert.equal(t.snapshot(300).status, 'incomplete');
    t.outgoing(event('translate-subtitle-file-track', { index: 4 }), 400);
    t.incoming(event('add-external-subtitle-track', { index: 4, label: '(translated)' }), 500);
    assert.equal(t.snapshot(600).unverified, 1); assert.equal(t.snapshot(600).status, 'incomplete');
});

test('unsent scheduler backlog is included so progress cannot finish early', () => {
    const t = tracker(); t.backlog = 20;
    t.outgoing(event('translate-text', {text:'Hello'}),100);
    t.incoming(event('translated-text',{original:'Hello',translated:'مرحبا'}),200);
    const s=t.snapshot(300); assert.equal(s.total,21); assert.equal(s.pending,20);
    assert.equal(s.status,'translating'); assert.equal(s.percent,5);
});
