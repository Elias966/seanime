/* Bounded, duplicate-safe subtitle translation delivery. GPL-3.0. */
(function (root, factory) {
    const api = factory(), createQueue = api.createQueue;
    if (typeof module === "object" && module.exports) module.exports = api;
    else {
        root.SeanimeCreateSubtitleTranslationQueue = createQueue;
        root.SeanimePreferDialogueSubtitleTracks = api.preferDialogueTracks;
    }
})(typeof window === "object" ? window : globalThis, function () {
    "use strict";
    // Forced/signs tracks are often the first English track in dual-audio releases.
    // Only suppress them when a full track in that same language is available.
    function preferDialogueTracks(tracks) {
        const language = track => String(track.languageIETF || track.language || "").toLowerCase().split("-")[0];
        const partial = track => track.forced || (!/\b(?:full|dialog(?:ue)?|sdh)\b/i.test(track.label || "") && /(?:\bs\s*&\s*s\b|\bsigns?\b|\bsongs?\b|\bforced\b|\bop\s*[/&+]\s*ed\b)/i.test(track.label || ""));
        return tracks.filter(track => !partial(track) || !tracks.some(other =>
            language(other) === language(track) && !partial(other)));
    }
    // Keep ASS outside the model. Each translated run retains its own overrides,
    // hard breaks and drawing state; cached translations never cache presentation.
    function createAssPlan(text) {
        // A line break is presentation, not a sentence boundary. Translating its
        // halves independently loses subjects/tense and scrambles Arabic meaning.
        const leading = String(text || "").match(/^(?:\{[^}]*\})*/)?.[0] || "";
        const body = String(text || "").slice(leading.length);
        if (!/\{[^}]*\}/.test(body) && /\\[Nn]|\r?\n/.test(body)) {
            const source = body.replace(/\\[Nnh]|\r?\n/g, " ").replace(/\s+/g, " ").trim();
            if (/\p{L}/u.test(source)) return {
                parts: [leading, body], runs: [{source,index:1,leading:"",trailing:""}],
                render(values) {
                    let value = String(values[0] ?? source).trim();
                    if (/[{}]|\\(?:[a-z]+|[Nnh])/i.test(value)) value = source;
                    return leading + value.replace(/\r?\n/g, "\\N");
                },
            };
        }
        const parts = [], runs = [];
        let drawing = false;
        const tokens = String(text || "").split(/(\{[^}]*\}|\\[Nnh]|\r?\n)/g);
        for (const token of tokens) {
            if (!token) continue;
            if (token.startsWith("{") && token.endsWith("}")) {
                parts.push(token);
                for (const match of token.matchAll(/\\p\s*(\d+)(?![\d.])/g)) drawing = Number(match[1]) > 0;
            } else if (drawing || /^\\[Nnh]$|^\r?\n$/.test(token) || !/\p{L}/u.test(token)) {
                parts.push(token);
            } else {
                const index = parts.length, leading = token.match(/^\s*/)[0], trailing = token.match(/\s*$/)[0];
                const source = token.trim();
                parts.push(token); runs.push({ source, index, leading, trailing });
            }
        }
        return { parts, runs, render(values) {
            const output = parts.slice();
            runs.forEach((run, i) => {
                // Translation is plain text, never executable ASS or HTML markup.
                let value = String(values[i] ?? run.source).trim();
                if (/[{}]|\\(?:[a-z]+|[Nnh])/i.test(value)) value = run.source;
                output[run.index] = run.leading + value.replace(/\r?\n/g, "\\N") + run.trailing;
            });
            return output.join("");
        } };
    }
    // Collapse character/syllable animation layers into readable timed phrases.
    // Translate source words once, rather than placing Arabic words in Latin glyph slots.
    function animationInfo(text, meta) {
        const plain = String(text).replace(/\{[^}]*\}/g, "").replace(/\\[Nnh]/g, " ").trim();
        const position = /\\pos\(([-.\d]+),\s*([-.\d]+)\)/.exec(text);
        const move = /\\move\(([-.\d]+),\s*([-.\d]+)/.exec(text);
        if (!plain || !/^[\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]+$/u.test(plain) || !(position || move) || !meta || (!move && meta.effect !== "fx")) return null;
        const point = position || move;
        return { plain, x: Number(point[1]), y: Number(point[2]), primary: !!position,
            start: meta.start, end: meta.end, style: meta.style };
    }
    function normalizeAnimations(records) {
        const output = records.map(record => ({ ...record })), styles = new Map();
        for (let i = 0; i < records.length; i++) {
            const info = animationInfo(records[i].text, records[i]);
            if (!info) continue;
            const key = String(info.style); if (!styles.has(key)) styles.set(key, []);
            styles.get(key).push({ ...info, index: i });
        }
        for (const entries of styles.values()) {
            if (entries.length < 8 || entries.filter(e => e.plain.length <= 3).length < entries.length / 2) continue;
            // Secondary layers often contain complete words repeated for glow/shadows.
            const secondary = entries.filter(e => !e.primary), primary = entries.filter(e => e.primary);
            const useGlyphs = primary.length > 8 && primary.filter(e => e.plain.length === 1).length > primary.length * .7;
            const useWords = !useGlyphs && secondary.filter(e => e.plain.length > 1).length >= 5;
            const seen = new Set(), chosen = (useWords ? secondary : useGlyphs ? primary.filter(e => e.plain.length === 1) : primary).filter(e => {
                const key = `${e.start}:${e.x}:${e.y}:${e.plain}`;
                if (seen.has(key)) return false; seen.add(key); return true;
            }).sort((a, b) => a.start - b.start || a.x - b.x);
            if (chosen.length < 4) continue;
            const widths = {i:.28,l:.28,j:.28,t:.39,f:.35,m:.97,w:.82,r:.41,s:.52,I:.30,J:.30,M:.86,W:.99};
            const width = char => widths[char] || .62;
            const ratios = [], gaps = [];
            if (useGlyphs) for (let i=1;i<chosen.length;i++) {
                const a=chosen[i-1], b=chosen[i], gap=b.x-a.x;
                if (gap>0 && gap<60 && Math.abs(a.y-b.y)<5 && b.start-a.start<400) {
                    gaps.push(gap); ratios.push(gap/((width(a.plain)+width(b.plain))/2));
                }
            }
            const stepCounts = new Map();for(const gap of gaps) { const step=Math.round(gap);stepCounts.set(step,(stepCounts.get(step)||0)+1); }
            const mono = [...stepCounts].sort((a,b)=>b[1]-a[1])[0];
            const monoStep = mono && mono[1] > gaps.length*.65 ? mono[0] : 0;
            ratios.sort((a,b)=>a-b);const scale=monoStep || ratios[Math.floor(ratios.length/2)] || 40;
            const groups = [], rows = new Map();
            for (const event of chosen) {
                const row = Math.round(event.y / 10), previous = rows.get(row);
                if (!previous || event.start - previous.end > 1200 || event.x < previous.lastX - 45 || event.start - previous.start > 12000) {
                    const group = { events: [event], start: event.start, end: event.end, lastX: event.x };
                    rows.set(row, group); groups.push(group);
                } else {
                    previous.events.push(event); previous.end = Math.max(previous.end, event.end); previous.lastX = event.x;
                }
            }
            if (!groups.some(g => g.events.length >= 3)) continue;
            // Remove original letter animations; representatives below replace them.
            for (const event of entries) output[event.index] = { ...output[event.index], text: "" };
            for (const group of groups) {
                const list = group.events, first = list[0];
                const family = String(first.style).split(/[- ]/)[0];
                const englishLyrics = /rom|kana|kanji/i.test(String(first.style)) && records.some(record =>
                    String(record.style).startsWith(family) && /eng|tlt|translat/i.test(String(record.style)) &&
                    record.start <= group.end && record.end >= group.start &&
                    /\p{L}/u.test(record.text.replace(/\{[^}]*\}/g, "")));
                if (englishLyrics) continue; // The translated English lyric replaces its animated romanization.

                const text = useGlyphs ? list.map((e,i) => {
                    const a=list[i-1], expected=a ? monoStep || scale*(width(a.plain)+width(e.plain))/2 : 0;
                    return (a && e.x-a.x-expected>Math.max(3,scale*.12) ? " " : "") + e.plain;
                }).join("") : list.map(e => e.plain).join(useWords ? " " : "");
                if (!text.trim()) continue;
                const start = Math.max(0, group.start - (useWords ? 750 : 0)), end = group.end;
                const x = (records[first.index].width || 1920) / 2;
                const y = first.y;
                output[first.index] = { ...output[first.index], start, end,
                    text: `{\\an8\\pos(${x},${y})\\fe-1\\fsp0\\q0}${text}`, normalized: true };
            }
        }
        // Karaoke line changes can split a sentence immediately before its verb.
        // Keep a short lowercase continuation with its subject for the model.
        const preceding = new Map();
        for (const event of output.filter(e => e.normalized).sort((a,b) => a.start-b.start)) {
            const previous = preceding.get(event.style), body=event.text.replace(/\{[^}]*\}/g, "");
            const before=previous?.text.replace(/\{[^}]*\}/g, "") || "";
            if (previous && /^[a-z]/.test(body) && !/[.!?]$/.test(before) && event.start-previous.end<1500 &&
                event.end-previous.start<12000 && before.length+body.length<160) {
                previous.text += " " + body; previous.end=Math.max(previous.end,event.end);
                event.text="";event.normalized=false;
            } else preceding.set(event.style,event);
        }
        // Phrase-sized Arabic needs a full-width box; simultaneous lyric layers
        // get separate rows rather than occupying the same character coordinates.
        const lanes = [];
        for (const event of output.filter(e => e.normalized).sort((a,b) => a.start - b.start)) {
            const match = /\\pos\(([-.\d]+),([-.\d]+)\)/.exec(event.text);
            let y = Number(match[2]);
            while (lanes.some(lane => lane.end > event.start && Math.abs(lane.y-y) < 90)) y += 100;
            lanes.push({end:event.end,y});
            event.text = event.text.replace(/(\\pos\([-.\d]+,)[-.\d]+/, `$1${y}`);
        }
        return output;
    }
    function createQueue(options) {
        const jobs = new Map(), results = new Map();
        const limit = options.limit ?? 4, timeout = options.timeoutMs ?? 75000;
        let active = 0, destroyed = false, draining = false;
        let animationTimer = null; const animations = [];
        const later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
        function notify() {
            const detail = { pending: animations.length + [...jobs.values()].filter(job => !job.active).length, active, limit };
            options.onProgress?.(detail);
            if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("seanime:translation-queue", { detail }));
        }
        function priority(job) {
            const now = options.getTime?.() || 0;
            const item = job.items.values().next().value;
            const target = item?.__formatted ? item.item : item;
            const start = item?.__fileTime ?? options.getStart?.(target) ?? 0;
            const end = item?.__fileEnd ?? options.getEnd?.(target) ?? start;
            return [end >= now ? 0 : 1, Math.abs(start - now)];
        }
        function choose() {
            return [...jobs.values()].filter(job => !job.active).sort((a, b) => {
                const pa = priority(a), pb = priority(b);
                return pa[0] - pb[0] || pa[1] - pb[1];
            })[0];
        }
        function deliver(job, translated) {
            if (!jobs.has(job.text)) return;
            if (/[{}]|\\[A-Za-z]+|[\uE000-\uF8FF\uFFFD]/u.test(String(translated || ""))) translated = job.text;
            cancel(job.timer);
            if (job.active) active--;
            jobs.delete(job.text);
            // Failed original-language fallback must not become a successful cache entry.
            if (/[\u0620-\u064a\u066e-\u06d3\u06fa-\u06ff\u0750-\u077f\u08a0-\u08c9]/u.test(translated || "")) results.set(job.text, translated);
            for (const item of job.items) {
                if (item?.__formatted) item.receive(translated);
                else options.apply(item, translated);
            }
        }
        function drain() {
            if (destroyed || draining) return;
            draining = true;
            try {
                while (active < limit) {
                    const job = choose(); if (!job) break;
                    job.active = true; active++;
                    job.timer = later(() => {
                        if (destroyed || !jobs.has(job.text)) return;
                        active--; job.active = false;
                        if (++job.retries > (options.maxRetries ?? 1)) deliver(job, job.text);
                        drain(); notify();
                    }, timeout);
                    job.timer?.unref?.();
                    try { options.send(job.text); }
                    catch { cancel(job.timer); deliver(job, job.text); }
                }
            } finally { draining = false; notify(); }
        }
        const api = {
            enqueue(text, item) {
                if (destroyed) return;
                if (results.has(text)) {
                    if (item?.__formatted) item.receive(results.get(text));
                    else options.apply(item, results.get(text));
                    return;
                }
                let job = jobs.get(text);
                if (job) { job.items.add(item); return; }
                job = { text, items: new Set([item]), active: false, retries: 0, timer: null };
                jobs.set(text, job); drain();
            },
            enqueueFormatted(text, item, receive, timing, prepared = false) {
                if (destroyed) return;
                const meta = timing || (item?.assEvent ? { start: item.assEvent.Start, end: item.assEvent.Start + item.assEvent.Duration, style: item.event?.extraData?.style || item.assEvent.Style, effect: item.event?.extraData?.effect, width: options.getWidth?.() } : null);
                if (!prepared && animationInfo(text, meta)) {
                    animations.push({ text, item, receive, timing, ...meta });
                    cancel(animationTimer); animationTimer = later(() => {
                        animationTimer = null;
                        const original = animations.splice(0), normalized = normalizeAnimations(original);
                        for (let i = 0; i < original.length; i++) {
                            const entry = original[i], next = normalized[i];
                            const layout = next.normalized ? { Start: next.start, Duration: next.end - next.start } : undefined;
                            api.enqueueFormatted(next.text, entry.item, (value) => {
                                if (entry.receive) entry.receive(value, layout);
                                else options.apply(entry.item, value, layout);
                            }, next, true);
                        }
                        notify();
                    }, 1000);
                    notify(); return;
                }
                const plan = createAssPlan(text), values = new Array(plan.runs.length);
                let remaining = plan.runs.length;
                const apply = result => (receive || (value => options.apply(item, value)))(result);
                if (!remaining) { if (!destroyed) apply(text); return; }
                plan.runs.forEach((run, index) => api.enqueue(run.source, {
                    __formatted: true, item, __fileTime: timing?.start, __fileEnd: timing?.end,
                    receive(value) { values[index] = value; if (!--remaining && !destroyed) apply(plan.render(values)); },
                }));
            },
            enqueueAss(content, receive, progress) {
                const lines = content.split(/(?<=\n)/), events = [];
                let inEvents = false, textColumn = 9;
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (/^\s*\[/.test(line)) inEvents = /^\s*\[Events\]/i.test(line);
                    if (!inEvents) continue;
                    if (/^Format:/i.test(line)) textColumn = line.slice(line.indexOf(":") + 1).trim().split(",").findIndex(x => x.trim().toLowerCase() === "text");
                    if (!/^Dialogue:/i.test(line) || textColumn < 0) continue;
                    let offset = line.indexOf(":") + 1;
                    for (let column = 0; column < textColumn && offset > 0; column++) offset = line.indexOf(",", offset) + 1;
                    if (!offset) continue;
                    const ending = line.match(/\r?\n$/)?.[0] || "", prefix = line.slice(0, offset);
                    const fields = prefix.slice(prefix.indexOf(":") + 1).split(",");
                    const millis = value => { const n = String(value).trim().split(":").map(Number); return n.length === 3 ? ((n[0] * 60 + n[1]) * 60 + n[2]) * 1000 : 0; };
                    events.push({ index: i, prefix, ending, text: line.slice(offset, ending ? -ending.length : undefined), style: fields[3], effect: fields[8], width: Number(content.match(/PlayResX:\s*(\d+)/i)?.[1]) || 1920, start: millis(fields[1]), end: millis(fields[2]) });
                }
                let remaining = events.length, shown = Date.now();
                if (!remaining) { if (!destroyed) receive(content); return; }
                for (const event of events) api.enqueueFormatted(event.text, null, (translated, layout) => {
                    let prefix = event.prefix;
                    if (layout) {
                        const fields = prefix.split(","), stamp = ms => {
                            let cs = Math.round(ms / 10); const h = Math.floor(cs / 360000); cs %= 360000;
                            const m = Math.floor(cs / 6000); cs %= 6000;
                            return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(cs / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
                        };
                        fields[1] = stamp(layout.Start); fields[2] = stamp(layout.Start + layout.Duration); prefix = fields.join(",");
                    }
                    lines[event.index] = prefix + translated + event.ending;
                    if (!--remaining && !destroyed) receive(lines.join(""));
                    // Finished lines show while the rest of the file is still being translated
                    else if (progress && !destroyed && Date.now() - shown > 3000) { shown = Date.now(); progress(lines.join("")); }
                }, event);
            },
            accept(text, translated) {
                const job = jobs.get(text); if (!job || !job.active) return false;
                deliver(job, translated); drain(); return true;
            },
            clear() {
                destroyed = true; cancel(animationTimer); animations.length = 0;
                for (const job of jobs.values()) cancel(job.timer);
                jobs.clear(); results.clear(); active = 0; notify();
            },
            stats() { return { active, pending: animations.length + jobs.size - active, cached: results.size }; },
        };
        return api;
    }
    return { createQueue, createAssPlan, preferDialogueTracks, normalizeAnimations };
});
