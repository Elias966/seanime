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
    function createQueue(options) {
        const jobs = new Map(), results = new Map();
        const limit = options.limit ?? 4, timeout = options.timeoutMs ?? 75000;
        let active = 0, destroyed = false, draining = false;
        const later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
        function notify() {
            const detail = { pending: [...jobs.values()].filter(job => !job.active).length, active, limit };
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
            enqueueFormatted(text, item, receive, timing) {
                const plan = createAssPlan(text), values = new Array(plan.runs.length);
                let remaining = plan.runs.length;
                const apply = result => (receive || (value => options.apply(item, value)))(result);
                if (!remaining) { if (!destroyed) apply(text); return; }
                plan.runs.forEach((run, index) => api.enqueue(run.source, {
                    __formatted: true, item, __fileTime: timing?.start, __fileEnd: timing?.end,
                    receive(value) { values[index] = value; if (!--remaining && !destroyed) apply(plan.render(values)); },
                }));
            },
            enqueueAss(content, receive) {
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
                    events.push({ index: i, prefix, ending, text: line.slice(offset, ending ? -ending.length : undefined), start: millis(fields[1]), end: millis(fields[2]) });
                }
                let remaining = events.length;
                if (!remaining) { if (!destroyed) receive(content); return; }
                for (const event of events) api.enqueueFormatted(event.text, null, translated => {
                    lines[event.index] = event.prefix + translated + event.ending;
                    if (!--remaining && !destroyed) receive(lines.join(""));
                }, event);
            },
            accept(text, translated) {
                const job = jobs.get(text); if (!job || !job.active) return false;
                deliver(job, translated); drain(); return true;
            },
            clear() {
                destroyed = true;
                for (const job of jobs.values()) cancel(job.timer);
                jobs.clear(); results.clear(); active = 0; notify();
            },
            stats() { return { active, pending: jobs.size - active, cached: results.size }; },
        };
        return api;
    }
    return { createQueue, createAssPlan, preferDialogueTracks };
});
