// Electron leaves out some extension APIs that uBlock Origin's startup touches
// (webNavigation, privacy, contextMenus, browserAction, windows, a few tabs methods).
// Stub the missing ones so it can start and load its filter lists. Electron also gives
// webview requests no tab (tabId -1), and uBO filters tab-less requests only in advanced
// mode, so a managed policy turns that on.
(() => {
    const event = () => ({ addListener() {}, removeListener() {}, hasListener() { return false; } });
    const later = (cb, value) => { if (typeof cb === 'function') setTimeout(() => cb(value)); return Promise.resolve(value); };
    const noop = (...args) => later(args.find(a => typeof a === 'function'));
    const fill = (name, methods, extra = {}) => {
        const ns = chrome[name] ??= {};
        for (const m of methods) if (typeof ns[m] !== 'function') ns[m] = noop;
        for (const [k, v] of Object.entries(extra)) ns[k] ??= v;
    };
    const setting = () => ({
        get: (_, cb) => later(cb, { value: false, levelOfControl: 'not_controllable' }),
        set: noop, clear: noop, onChange: event(),
    });
    fill('webNavigation', [], {
        getFrame: (_, cb) => later(cb, null),
        getAllFrames: (_, cb) => later(cb, []),
        onCreatedNavigationTarget: event(), onCommitted: event(), onDOMContentLoaded: event(),
    });
    fill('privacy', [], {
        network: { networkPredictionEnabled: setting(), webRTCIPHandlingPolicy: setting() },
        websites: { hyperlinkAuditingEnabled: setting() },
    });
    fill('contextMenus', ['create', 'update', 'remove', 'removeAll'], { onClicked: event() });
    fill('browserAction', ['setBadgeBackgroundColor', 'setBadgeText', 'setIcon', 'setTitle'], { onClicked: event() });
    fill('windows', ['create', 'get', 'update'], { onFocusChanged: event(), onRemoved: event(), WINDOW_ID_NONE: -1 });
    // AniDL and its mirror portal disable their download buttons when their ads are
    // blocked, so they are trusted sites; the app still denies every popup they open.
    const policy = {
        userSettings: [['advancedUserEnabled', 'true']],
        toOverwrite: { trustedSiteDirectives: ['anidl.org', 'ryzenddl.info'] },
    };
    // Electron's own storage.managed exists but always fails, so replace it. uBO reads a
    // cached copy first, so refresh that too (storage calls run in order, before uBO's).
    chrome.storage.managed = { get: (...args) => later(args.find(a => typeof a === 'function'), policy) };
    chrome.storage.local.set({ cachedManagedStorage: policy });
    fill('tabs', ['executeScript', 'get', 'insertCSS', 'query', 'reload', 'remove', 'removeCSS', 'sendMessage', 'update']);
})();
