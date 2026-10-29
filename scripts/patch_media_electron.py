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
    return text.replace('win.webContents.'+needle,NAVIGATION+'win.webContents.'+needle+GUARD,1).encode() if ('win.webContents.'+needle) in text else text.replace(needle,needle+GUARD,1).encode()
