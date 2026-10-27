/* Persistent artwork for local libraries, including local accounts. GPL-3.0. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else { root.SeanimeResolveImageUrl = api.resolve; api.install(root); }
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    const hosts = new Set(['s4.anilist.co', 's.anilist.co', 'artworks.thetvdb.com', 'image.tmdb.org', 'cdn.myanimelist.net', 'i.ytimg.com']);
    const helper = 'http://127.0.0.1:11435';
    function isArtwork(value) {
        try { const url = new URL(value); return url.protocol === 'https:' && hosts.has(url.hostname) && !url.username && !url.password && (!url.port || url.port === '443') && !url.hash; }
        catch { return false; }
    }
    function resolve(value, original = value) {
        const custom = typeof window !== 'undefined' && window.SeanimeCovers?.resolve(original);
        if (custom) return custom;
        if (typeof value !== 'string') return value;
        if (value.startsWith('{{LOCAL_ASSETS}}/')) return 'http://127.0.0.1:43211/offline-assets/' + value.slice('{{LOCAL_ASSETS}}/'.length);
        return isArtwork(value) ? helper + '/images?url=' + encodeURIComponent(value) : value;
    }
    function collect(value, output = new Set()) {
        if (typeof value === 'string' && isArtwork(value)) output.add(value);
        else if (Array.isArray(value)) value.forEach(item => collect(item, output));
        else if (value && typeof value === 'object') Object.values(value).forEach(item => collect(item, output));
        return output;
    }
    async function pool(items, task, concurrency) {
        let index = 0;
        await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (index < items.length) { const item = items[index++]; try { await task(item); } catch {} }
        }));
    }
    function install(win) {
        if (win.__seanimeArtworkInstalled) return;
        win.__seanimeArtworkInstalled = true;
        const base = 'http://127.0.0.1:43211', seen = new Set();
        let running = false, lastSuccess = 0;
        async function read(path) {
            const response = await win.fetch(base + path, { credentials: 'include', signal: AbortSignal.timeout(20000) });
            if (!response.ok) throw Error('Metadata unavailable');
            return (await response.json()).data;
        }
        async function warm() {
            if (running || win.navigator.onLine === false || Date.now() - lastSuccess < 300000) return;
            running = true;
            let newlyStored = 0;
            try {
                const health = await win.fetch(helper + '/health', { signal: AbortSignal.timeout(3000) });
                if (!health.ok) return;
                const files = await read('/api/v1/library/local-files');
                const ids = [...new Set((Array.isArray(files) ? files : []).filter(file => !file.ignored && file.mediaId > 0).map(file => file.mediaId))];
                await pool(ids, async id => {
                    // The entry contains covers AND episode metadata, so unseen local
                    // episodes can be warmed without downloading their video again.
                    const entry = await read('/api/v1/library/anime-entry/' + id);
                    const urls = [...collect(entry)].filter(url => !seen.has(url));
                    await pool(urls, async url => {
                        const response = await win.fetch(resolve(url), { signal: AbortSignal.timeout(40000) });
                        if (response.ok) { await response.arrayBuffer(); seen.add(url); newlyStored++; }
                    }, 2);
                }, 2);
                lastSuccess = Date.now();
                if (newlyStored) win.dispatchEvent(new Event('seanime:artwork-ready'));
            } catch { /* Offline: already stored artwork remains usable. Retry later. */ }
            finally { running = false; }
        }
        win.addEventListener('online', warm);
        win.setInterval(warm, 300000);
        if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', warm, { once: true });
        else warm();
    }
    return { resolve, collect, isArtwork, install };
});
