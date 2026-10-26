/* Unofficial Seanime translation progress overlay. GPL-3.0, like Seanime.
 * Observes existing player messages; never changes subtitle requests/results.
 * Counts the currently queued work, not an unknown full-episode line count.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else api.install(root);
})(typeof window === "object" ? window : globalThis, function () {
    "use strict";
    const hasArabic = text => /[\u0620-\u064a\u066e-\u06d3\u06fa-\u06ff\u0750-\u077f\u08a0-\u08c9]/u.test(text || "");
    const isArabic = lang => /^ar(?:$|[-_])/i.test(lang || "") || /^arabic$/i.test(lang || "");
    const cleanDialogue = text => String(text || "").replace(/\{[^}]*\}|<[^>]*>/g, "").replace(/\\[Nnh]/g, " ").trim();
    function classify(source, output) {
        source = cleanDialogue(source); output = cleanDialogue(output);
        const letters = output.match(/\p{L}/gu) || [];
        if (!/\p{L}/u.test(source)) return "neutral";
        const arabic = letters.filter(letter => hasArabic(letter)).length;
        if (!arabic) return "unchanged";
        const foreign = letters.length - arabic;
        const otherScript = letters.some(letter => letter.codePointAt(0) > 127 && !hasArabic(letter));
        const foreignWords = output.match(/[A-Za-z]+/g) || [];
        return otherScript || (foreign >= 4 && arabic / letters.length < .75) || foreignWords.length >= 2 ? "mixed" : "arabic";
    }
    function inspectFile(content) {
        if (typeof content !== "string" || !content.trim()) return null;
        const lines = content.split(/\r?\n/), dialogue = [];
        if (/^\s*\[Events\]/im.test(content) || /^Dialogue\s*:/im.test(content)) {
            let textIndex = 9;
            for (const line of lines) {
                if (/^Format\s*:/i.test(line)) {
                    const index = line.slice(line.indexOf(":") + 1).split(",").map(x => x.trim().toLowerCase()).indexOf("text");
                    if (index >= 0) textIndex = index;
                }
                if (/^Dialogue\s*:/i.test(line)) {
                    let start = line.indexOf(":") + 1;
                    for (let i = 0; i < textIndex && start > 0; i++) start = line.indexOf(",", start) + 1;
                    if (start > 0) dialogue.push(line.slice(start));
                }
            }
        } else {
            let note = false;
            for (const line of lines) {
                const text = line.trim();
                if (!text) { note = false; continue; }
                if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(text)) { note = true; continue; }
                if (note || /^(WEBVTT|\d+$)/.test(text) || text.includes("-->")) continue;
                dialogue.push(text);
            }
        }
        if (!dialogue.length) return null;
        const stats = { total: dialogue.length, arabic: 0, mixed: 0, unchanged: 0, neutral: 0 };
        for (const text of dialogue) stats[classify(text, text)]++;
        return stats;
    }


    class Progress {
        constructor() { this.enabled = null; this.reset(); }
        reset() {
            this.lines = []; this.files = new Map(); this.offline = false; this.lastChange = 0;
        }
        settings(settings) {
            const player = settings?.mediaPlayer;
            if (!player) return;
            const enabled = !!player.vcTranslate && isArabic(player.vcTranslateTargetLanguage);
            if (enabled === false || (this.enabled !== null && this.enabled !== enabled)) this.reset();
            this.enabled = enabled;
        }
        outgoing(message, now = Date.now()) {
            if (message?.type !== "videocore") return;
            const event = message.payload, payload = event?.payload || {};
            if (event?.type === "video-loaded" || event?.type === "video-terminated") { this.reset(); return; }
            if (this.enabled === false) return;
            if (event?.type === "translate-text" && typeof payload.text === "string" && payload.text.trim()) {
                this.lines.push({ text: payload.text, start: now, state: "pending" });
                this.lastChange = now;
            } else if (event?.type === "translate-subtitle-file-track") {
                this.files.set(String(payload.index), { state: "pending", start: now });
                this.lastChange = now;
            }
        }
        incoming(message, now = Date.now()) {
            if (message?.type === "settings") { this.settings(message.payload); return; }
            if (this.enabled === false || message?.type !== "videocore") return;
            const event = message.payload, payload = event?.payload || {};
            if (event?.type === "translated-text") {
                // Match one response to one request, including repeated dialogue.
                const matches = this.lines.filter(row => row.text === payload.original);
                const row = matches.find(row => row.state === "pending") || matches.find(row => row.state === "timeout");
                if (row) {
                    row.state = classify(payload.original, payload.translated);
                    this.lastChange = now;
                }
            } else if (["add-external-subtitle-track", "add-media-caption-track"].includes(event?.type)) {
                const file = this.files.get(String(payload.index));
                if (file && /\(translated\)/i.test(payload.label || "")) {
                    file.state = "received"; file.stats = inspectFile(payload.content); this.lastChange = now;
                }
            }
        }
        snapshot(now = Date.now()) {
            for (const row of this.lines) if (row.state === "pending" && now - row.start > 75000) row.state = "timeout";
            for (const file of this.files.values()) if (file.state === "pending" && now - file.start > 300000) file.state = "stalled";
            const count = state => this.lines.filter(row => row.state === state).length;
            const files = [...this.files.values()], filePending = files.filter(file => file.state === "pending").length;
            const fileStats = files.map(file => file.stats).filter(Boolean);
            const sum = key => fileStats.reduce((total, stats) => total + stats[key], 0);
            const total = this.lines.length + sum("total"), pending = count("pending");
            const arabic = count("arabic") + sum("arabic"), neutral = count("neutral") + sum("neutral");
            const mixed = count("mixed") + sum("mixed"), unchanged = count("unchanged") + sum("unchanged"), timeout = count("timeout");
            const stalled = files.some(file => file.state === "stalled");
            const fileUnchanged = fileStats.filter(stats => stats.unchanged > 0).length;
            const unverified = files.filter(file => file.state === "received" && !file.stats).length;
            const processed = total - pending, active = pending > 0 || filePending > 0;
            const issues = unchanged + mixed + timeout + unverified + (stalled ? 1 : 0);
            return { total, processed, pending, arabic, neutral, mixed, unchanged, timeout, filePending, fileUnchanged, unverified, stalled, active,
                percent: total ? Math.round((arabic + neutral) / total * 100) : null,
                status: this.offline ? "disconnected" : active ? "translating" : issues ? "incomplete" : "received",
                visible: this.enabled && (total > 0 || files.length > 0) &&
                    (active || issues > 0 || now - this.lastChange < 10000),
                offline: this.offline };

        }
    }

    function install(win) {
        if (win.__seanimeTranslationProgressInstalled || !win.WebSocket) return;
        win.__seanimeTranslationProgressInstalled = true;
        const tracker = new Progress(), watched = new WeakSet();
        let panel, title, counts, detail, bar, track, live, target, scheduled = false;
        const doc = win.document;
        function mount() {
            if (!doc.body) return;
            if (!panel) {
                const style = doc.createElement("style");
                style.textContent = `
#seanime-translation-progress{position:fixed;top:18px;left:18px;z-index:2147483000;width:min(300px,calc(100vw - 36px));box-sizing:border-box;padding:12px 14px;border:1px solid #ffffff24;border-radius:12px;background:#10131bee;color:#f8fafc;box-shadow:0 8px 28px #0006;backdrop-filter:blur(12px);font:12px/1.5 system-ui,sans-serif;pointer-events:none;text-align:left;color-scheme:dark}
#seanime-translation-progress[hidden]{display:none!important}
#seanime-translation-progress .translation-title{font-size:13px;font-weight:650;letter-spacing:.1px}
#seanime-translation-progress .translation-counts{margin-top:4px;font-variant-numeric:tabular-nums}
#seanime-translation-progress .translation-detail{color:#bac3d1;font-size:11px;margin-top:4px}
#seanime-translation-progress .translation-track{height:4px;border-radius:4px;background:#ffffff20;overflow:hidden;margin-top:9px}
#seanime-translation-progress .translation-fill{height:100%;background:#8b9dff;border-radius:4px;transition:width .25s ease}
#seanime-translation-progress[data-state=warning] .translation-fill{background:#f4bc63}
#seanime-translation-progress[data-state=done] .translation-fill{background:#75d7ac}
#seanime-translation-progress[data-indeterminate=true] .translation-fill{width:35%!important;animation:seanime-translate-slide 1.5s ease-in-out infinite}
@keyframes seanime-translate-slide{0%{transform:translateX(-110%)}100%{transform:translateX(390%)}}
@media(prefers-reduced-motion:reduce){#seanime-translation-progress .translation-fill{animation:none!important;transition:none}}
`;
                doc.head.appendChild(style);
                panel = doc.createElement("aside"); panel.id = "seanime-translation-progress"; panel.hidden = true;
                panel.setAttribute("aria-label", "Subtitle translation progress to Arabic");
                title = doc.createElement("div"); title.className = "translation-title";
                counts = doc.createElement("div"); counts.className = "translation-counts";
                detail = doc.createElement("div"); detail.className = "translation-detail";
                track = doc.createElement("div"); track.className = "translation-track"; track.setAttribute("role", "progressbar");
                track.setAttribute("aria-label", "Arabic-ready subtitle results");
                track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", "100");
                bar = doc.createElement("div"); bar.className = "translation-fill"; track.appendChild(bar);
                live = doc.createElement("span"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
                live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)";
                panel.append(title, counts, track, detail, live);
            }
            target = doc.fullscreenElement || doc.body;
            if (panel.parentNode !== target) target.appendChild(panel);
        }
        let lastAnnouncement = 0, lastAnnouncementPhase = "";
        function render() {
            scheduled = false; mount(); if (!panel) return;
            const s = tracker.snapshot(); panel.hidden = !s.visible;
            if (!s.visible) return;
            const warning = s.offline || s.timeout || s.stalled || s.unchanged || s.mixed || s.unverified;
            panel.dataset.state = warning ? "warning" : s.active ? "active" : "done";
            const indeterminate = s.active && (s.filePending > 0 || s.percent === null);
            panel.dataset.indeterminate = String(indeterminate);
            title.textContent = s.offline ? "Translation disconnected → العربية" : warning ? (s.active ? "Translating · incomplete results → العربية" : "Translation incomplete → العربية") :
                s.active ? "Translating → العربية" : "Arabic results received → العربية";
            counts.textContent = s.total ? `${s.arabic + s.neutral} / ${s.total} Arabic-ready lines · ${s.percent}%` :
                s.filePending ? "Translating subtitle file…" : s.stalled ? "Subtitle file is taking longer than expected" : "Subtitle file received";
            detail.textContent = [s.total ? `${s.processed} processed · ${s.pending} pending` : "", s.unchanged ? `${s.unchanged} untranslated` : "",
                s.mixed ? `${s.mixed} mixed-language` : "", s.timeout ? `${s.timeout} timed out` : "", s.unverified ? `${s.unverified} file could not be checked` : "", s.filePending && s.total ? "Subtitle file also processing…" : ""].filter(Boolean).join(" · ") ||
                (s.filePending ? "Waiting for the translated file; line total unavailable" : "Arabic script detected; translation accuracy is not verified");
            const value = s.percent ?? (!s.filePending && !s.stalled ? 100 : 0);
            bar.style.width = `${value}%`;
            if (indeterminate || (s.stalled && s.percent === null)) track.removeAttribute("aria-valuenow");
            else track.setAttribute("aria-valuenow", String(value));
            const announcement = title.textContent + ". " + counts.textContent;
            const phase = `${s.active}:${s.filePending > 0}:${!!warning}:${s.offline}`;
            if (live.textContent !== announcement && (phase !== lastAnnouncementPhase || Date.now() - lastAnnouncement > 3000 || !s.active)) {
                live.textContent = announcement;
                lastAnnouncement = Date.now(); lastAnnouncementPhase = phase;
            }
        }
        function schedule() { if (!scheduled) { scheduled = true; win.requestAnimationFrame(render); } }
        function read(raw) { try { return typeof raw === "string" ? JSON.parse(raw) : null; } catch { return null; } }
        function watch(socket) {
            if (watched.has(socket)) return;
            let base;
            try { const url = new URL(socket.url); if (!/^wss?:$/.test(url.protocol) || url.pathname !== "/events") return;
                url.protocol = url.protocol === "wss:" ? "https:" : "http:"; base = url.origin;
            } catch { return; }
            watched.add(socket);
            let loading;
            function loadSettings() {
                if (loading) return loading;
                loading = win.fetch(base + "/api/v1/settings", { credentials: "include" })
                    .then(r => r.ok ? r.json() : null).then(data => { tracker.settings(data?.data); schedule(); })
                    .catch(() => {}).finally(() => { loading = null; });
                return loading;
            }
            loadSettings();
            socket.addEventListener("message", event => { const data = read(event.data); tracker.incoming(data); schedule(); });
            socket.addEventListener("close", () => { tracker.offline = true; schedule(); });
            socket.addEventListener("open", () => { tracker.offline = false; loadSettings(); schedule(); });
        }
        const nativeSend = win.WebSocket.prototype.send;
        win.WebSocket.prototype.send = function (data) {
            // Native send must succeed before an item counts as queued.
            watch(this); const result = nativeSend.call(this, data); const message = read(data);
            if (message?.type === "videocore") { tracker.offline = false; tracker.outgoing(message); schedule(); }
            return result;
        };
        doc.addEventListener("DOMContentLoaded", schedule, { once: true });
        doc.addEventListener("fullscreenchange", schedule);
        win.setInterval(() => { if (tracker.lines.length || tracker.files.size) schedule(); }, 1000);
        schedule();
    }
    return { Progress, install, hasArabic, isArabic, classify, inspectFile };
});
