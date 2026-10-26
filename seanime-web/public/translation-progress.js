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
                    row.state = hasArabic(payload.translated) ? "arabic" : "unchanged";
                    this.lastChange = now;
                }
            } else if (["add-external-subtitle-track", "add-media-caption-track"].includes(event?.type)) {
                const file = this.files.get(String(payload.index));
                if (file && /\(translated\)/i.test(payload.label || "")) {
                    file.state = hasArabic(payload.content) ? "received" : "unchanged"; this.lastChange = now;
                }
            }
        }
        snapshot(now = Date.now()) {
            for (const row of this.lines) if (row.state === "pending" && now - row.start > 75000) row.state = "timeout";
            for (const file of this.files.values()) if (file.state === "pending" && now - file.start > 300000) file.state = "stalled";
            const total = this.lines.length, count = state => this.lines.filter(row => row.state === state).length;
            const pending = count("pending"), arabic = count("arabic"), unchanged = count("unchanged"), timeout = count("timeout");
            const files = [...this.files.values()], filePending = files.filter(file => file.state === "pending").length;
            const stalled = files.some(file => file.state === "stalled");
            const fileUnchanged = files.filter(file => file.state === "unchanged").length;
            const processed = total - pending, active = pending > 0 || filePending > 0;
            return { total, processed, pending, arabic, unchanged, timeout, filePending, fileUnchanged, stalled, active,
                percent: total ? Math.round(processed / total * 100) : null,
                visible: this.enabled && (total > 0 || files.length > 0) &&
                    (active || stalled || timeout > 0 || fileUnchanged > 0 || now - this.lastChange < 10000),
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
                track.setAttribute("aria-label", "Queued subtitle lines processed");
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
            const warning = s.offline || s.timeout || s.stalled || s.fileUnchanged;
            panel.dataset.state = warning ? "warning" : s.active ? "active" : "done";
            const indeterminate = s.active && (s.filePending > 0 || s.percent === null);
            panel.dataset.indeterminate = String(indeterminate);
            title.textContent = s.offline ? "Translation disconnected → العربية" : warning ? "Translation needs attention → العربية" :
                s.active ? "Translating → العربية" : "Translation finished → العربية";
            counts.textContent = s.total ? `${s.processed} / ${s.total} queued lines processed · ${s.percent}%` :
                s.filePending ? "Translating subtitle file…" : s.stalled ? "Subtitle file is taking longer than expected" : "Subtitle file received";
            detail.textContent = [s.total ? `${s.arabic} Arabic · ${s.pending} pending` : "", s.unchanged ? `${s.unchanged} unchanged` : "",
                s.timeout ? `${s.timeout} timed out` : "", s.fileUnchanged ? `${s.fileUnchanged} file returned without Arabic` : "", s.filePending && s.total ? "Subtitle file also processing…" : ""].filter(Boolean).join(" · ") ||
                (s.filePending ? "Waiting for the translated file; line total unavailable" : "Ready for playback");
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
    return { Progress, install, hasArabic, isArabic };
});
