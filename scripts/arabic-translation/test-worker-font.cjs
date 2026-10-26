const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const worker = fs.readFileSync(__dirname + '/../../seanime-web/public/jassub/jassub-worker.js', 'utf8');
// Execute the shipped renderer class itself, with only its WASM/render/network
// boundaries mocked. This checks data delivered to libass, not a copied repair.
function rendererContext() {
    const calls = { tracks: [], streamed: [], created: [], updated: [], fonts: [] };
    class Wasm {
        setThreads() {}
        removeTrack() {}
        createTrackMem(content) {calls.tracks.push(content);}
        processData(content) {calls.streamed.push(content);}
        createEvent(event) {calls.created.push(event);}
        setEvent(index, event) {calls.updated.push({index,event});}
    }
    class Canvas {setCanvas() {}}
    const context = {
        finalizer: Symbol('finalizer'), THREAD_COUNT: 1, LIBASS_YCBCR_MAP: {}, URL,
        self: {location: {href: 'http://127.0.0.1:43211/jassub/jassub-worker.js'}},
        fetch: () => {}, fetchtext: async () => context.urlContent,
        OffscreenCanvas: class {getContext() {return null;}}, Canvas2DRenderer: Canvas,
        jassub_worker_default: async () => ({_malloc: () => 0, JASSUB: Wasm}),
    };
    vm.runInNewContext(worker.slice(worker.indexOf('  var constructor = /* @__PURE__ */ Symbol.for("constructor");'), worker.lastIndexOf('  if (self.name === "jassub-worker")')) + '\nthis.Renderer=ASSRenderer;this.repair=repairArabicText;',context);
    context.Renderer.prototype._loadInitialFonts = async fonts => {calls.fonts.push(...fonts);};
    return {context,calls, async open(content, url = false) {
        context.urlContent = content;
        return await new context.Renderer({fonts: [], availableFonts: {}, defaultFont: 'Roboto', wasmUrl: 'worker.wasm', width: 1280, height: 720,
            ...(url ? {subUrl: 'http://example.invalid/sub.ass'} : {subContent: content})}, () => {}, {});
    }};
}
const format = 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';
const dialogue = text => 'Dialogue: 0,0:00:01.00,0:00:02.00,Sign,,0,0,0,,' + text;
const ass = text => '[Script Info]\r\nTitle: Test\r\n[V4+ Styles]\r\nStyle: Sign,Roboto,24\r\n[Events]\r\n' + format + '\r\n' + dialogue(text) + '\r\n';
const font = '\\fnDejaVu Sans';

test('inline content and fetched initial subUrl both reach WASM with Arabic font, font is bundled URL', async () => {
    for (const url of [false,true]) {
        const {open,calls}=rendererContext();await open(ass('مرحبا بالعالم'),url);
        assert.equal(calls.tracks[0],ass('{'+font+'}مرحبا بالعالم'));
        assert.deepEqual(calls.fonts,['http://127.0.0.1:43211/fonts/DejaVuSans.ttf']);
    }
});
test('createEvent and setEvent preserve all other event fields and leave caller objects unchanged', async () => {
    const {open,calls}=rendererContext();const r=await open(ass('English'));
    const event={Text:'{\\an8\\pos(15,20)\\fs25}مرحبا',Style:2,Start:4,Duration:3};
    const before=JSON.stringify(event);r.createEvent(event);r.setEvent(event,7);
    assert.equal(JSON.stringify(event),before);
    assert.equal(calls.created[0].Text,'{'+font+'}'+event.Text);
    assert.equal(calls.created[0].Style,2);assert.equal(calls.created[0].Start,4);
    assert.equal(calls.updated[0].index,7);assert.equal(calls.updated[0].event.Text,calls.created[0].Text);
});
test('whole track replacement and URL replacement both repair Arabic', async () => {
    const {open,calls,context}=rendererContext();const r=await open(ass('English'));
    r.setTrack(ass('أهلا'));context.urlContent=ass('أهلا');await r.setTrackByUrl('unused');
    assert.equal(calls.tracks[1],ass('{'+font+'}أهلا'));
    assert.equal(calls.tracks[2],calls.tracks[1]);
});
test('streamed processData repairs dialogue chunks and respects format and non-event sections', async () => {
    const {open,calls}=rendererContext();const r=await open(ass('English'));
    r.processData(dialogue('مرحبا'));assert.equal(calls.streamed[0],dialogue('{'+font+'}مرحبا'));
    r.processData('[Events]\nFormat: Start, End, Text\nDialogue: 0,1,أهلا, يا صديقي');
    assert.equal(calls.streamed[1],'[Events]\nFormat: Start, End, Text\nDialogue: 0,1,{'+font+'}أهلا, يا صديقي');
    r.processData('Dialogue: 1,2,شكرا');assert.equal(calls.streamed[2],'Dialogue: 1,2,{'+font+'}شكرا');
    const styles='[V4+ Styles]\nFormat: Name, Fontname\nStyle: Arabic,خط عربي';
    r.processData(styles);assert.equal(calls.streamed[3],styles);
    r.freeTrack();r.processData(dialogue('شكرا'));
    assert.equal(calls.streamed[4],dialogue('{'+font+'}شكرا'));
});
test('font changes within transforms preserve closing parentheses, placement, size, drawing and reset names', () => {
    const {context}=rendererContext();
    const source='{\\an7\\pos(10,20)\\fs24\\t(0,500,\\fs30\\fnRoboto)\\clip(1,m 0 0 l 20 20)\\rSign\\fscx120\\p1}m 0 0 l 10 10{\\p0}مرحبا{\\r}أهلا';
    const expected='{'+font+'}{\\an7\\pos(10,20)\\fs24\\t(0,500,\\fs30'+font+')\\clip(1,m 0 0 l 20 20)\\rSign'+font+'\\fscx120\\p1}m 0 0 l 10 10{\\p0}مرحبا{\\r'+font+'}أهلا';
    assert.equal(context.repair(source),expected);
    assert.equal(context.repair(expected),expected,'repair is idempotent');
});
test('English/drawing-only content and literal backslash text outside override blocks remain untouched', () => {
    const {context}=rendererContext();
    const english='{\\fnRoboto\\t(0,50,\\fs30)}English {\\p1}m 0 0 l 20 20';
    assert.equal(context.repair(english),english);
    const text='مرحبا literal \\r and \\fnOutside';assert.equal(context.repair(text),'{'+font+'}'+text);
    assert.equal(context.repair(undefined),undefined);
});
