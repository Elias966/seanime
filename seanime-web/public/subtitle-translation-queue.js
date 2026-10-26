/* Bounded, duplicate-safe subtitle translation delivery. GPL-3.0. */
(function (root, factory) {
    const createQueue = factory();
    if (typeof module === "object" && module.exports) module.exports = { createQueue };
    else root.SeanimeCreateSubtitleTranslationQueue = createQueue;
})(typeof window === "object" ? window : globalThis, function () {
    "use strict";
    return function createQueue(options) {
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
            const start = options.getStart?.(item) || 0;
            const end = options.getEnd?.(item) ?? start;
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
            cancel(job.timer);
            if (job.active) active--;
            jobs.delete(job.text);
            // Failed original-language fallback must not become a successful cache entry.
            if (/[\u0620-\u064a\u066e-\u06d3\u06fa-\u06ff\u0750-\u077f\u08a0-\u08c9]/u.test(translated || "")) results.set(job.text, translated);
            for (const item of job.items) options.apply(item, translated);
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
        return {
            enqueue(text, item) {
                if (destroyed) return;
                if (results.has(text)) { options.apply(item, results.get(text)); return; }
                let job = jobs.get(text);
                if (job) { job.items.add(item); return; }
                job = { text, items: new Set([item]), active: false, retries: 0, timer: null };
                jobs.set(text, job); drain();
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
    };
});
