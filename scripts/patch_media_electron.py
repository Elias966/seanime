"""Exact Denshi 3.10.4 popup guard for embedded media sources."""
MAIN_PATH='dist/main/index.js'
NAVIGATION=r'''win.webContents.on("will-navigate", (event, targetUrl) => {
        if (win.webContents.mainFrame.framesInSubtree.some(frame => frame !== win.webContents.mainFrame && /^https?:/.test(frame.url)) && /^https?:/.test(targetUrl) && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(targetUrl)) event.preventDefault();
    });
    '''
GUARD='''        // Embedded players cannot open advertising tabs in the browser.
        if (win.webContents.mainFrame.framesInSubtree.some(frame => frame !== win.webContents.mainFrame && /^https?:/.test(frame.url))) {
            return { action: "deny" };
        }
'''
def patch_main(raw):
    text=raw.decode();needle='setWindowOpenHandler(({ frameName, url }) => {\n'
    if text.count(needle)!=1:raise ValueError('Unexpected Electron popup handler')
    text = text.replace('win.webContents.'+needle,NAVIGATION+'win.webContents.'+needle+GUARD,1) if ('win.webContents.'+needle) in text else text.replace(needle,needle+GUARD,1)
    attach='win.webContents.on("will-attach-webview", (event, webPreferences, params) => {'
    if attach in text:
        hook='require(require("node:path").join(process.resourcesPath,"media-hub","media-source-browser.cjs")).attach(win);\n    '
        if text.count(attach)!=1:raise ValueError('Unexpected webview attachment handler')
        text=text.replace(attach,hook+attach,1)
    return text.encode()

PRELOAD_PATH = 'src/preload.js'
def patch_preload(raw):
    text=raw.decode();needle='"cast:error",'
    if text.count(needle)!=1:raise ValueError('Unexpected preload event channel whitelist')
    text=text.replace(needle,needle+'\n                "media-source:event",',1)
    # Lets the app tell direct-download sources where to save and start or cancel their downloads.
    emit='"macos-activation-policy-regular"'
    if text.count(emit)!=1:raise ValueError('Unexpected preload emit channel whitelist')
    return text.replace(emit,emit+',\n                "media-source:download",\n                "media-source:run"',1).encode()
