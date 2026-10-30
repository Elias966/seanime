"""Sites behind a human check are read through the installed Firefox, in its own profile.

Firefox stays hidden and only comes up when a page asks for a human check; the person answers it
and the window hides again. It talks over Firefox's developer socket: no WebDriver, nothing here
answers a check, and the personal Firefox profile is never touched."""
import json,os,re,shutil,socket,subprocess,threading,time
from pathlib import Path

CHECK_TITLE=re.compile(r'just a moment|attention required|verify you are human|are you a robot|security verification',re.I)
CHECK_BODY=re.compile(r'challenges\.cloudflare\.com|cf-chl|<title>\s*just a moment',re.I)
PREFS={'extensions.autoDisableScopes':0,'devtools.chrome.enabled':True,'devtools.debugger.remote-enabled':True,'devtools.debugger.force-local':True,'devtools.debugger.prompt-connection':False,
       'browser.shell.checkDefaultBrowser':False,'browser.aboutwelcome.enabled':False,'datareporting.policy.dataSubmissionEnabled':False,'browser.startup.page':0,
       'browser.sessionstore.resume_from_crash':False,'browser.startup.homepage_override.mstone':'ignore','toolkit.telemetry.reportingpolicy.firstRun':False}
IDLE_QUIT=20*60

class NeedsHuman(ValueError):pass

# Filled by site_agent, which owns what the AI reads from a page
OBSERVE_HOLDER={'js':'null','gate':'false'}

def is_check(title='',body=''):return bool(CHECK_TITLE.search(title or '') or CHECK_BODY.search((body or '')[:20000]))

def firefox_binary():
    for b in ('/snap/bin/firefox','/usr/bin/firefox','/usr/bin/firefox-esr'):
        if os.path.exists(b):return b
    return shutil.which('firefox')

def profile_dir(snap=None,home=None):
    home=Path(home or Path.home());snap=os.path.exists('/snap/bin/firefox') if snap is None else snap
    # Snap Firefox can only reach its own common folder
    return home/'snap/firefox/common/seanime-browser' if snap else Path(os.environ.get('XDG_DATA_HOME',str(home/'.local/share')))/'seanime/firefox-profile'

class Connection:
    def __init__(self,path):
        self.sock=socket.socket(socket.AF_UNIX);self.sock.settimeout(90);self.sock.connect(path);self.buf=b'';self.read(lambda p:p.get('from')=='root')
    def read(self,match):
        while True:
            while b':' not in self.buf:
                c=self.sock.recv(65536)
                if not c:raise OSError('Firefox closed')
                self.buf+=c
            head,_,rest=self.buf.partition(b':');n=int(head)
            while len(rest)<n:
                c=self.sock.recv(1<<20)
                if not c:raise OSError('Firefox closed')
                rest+=c
            packet=json.loads(rest[:n]);self.buf=rest[n:]
            if match(packet):return packet
    def request(self,to,kind,**args):
        body=json.dumps({'to':to,'type':kind,**args}).encode();self.sock.sendall(str(len(body)).encode()+b':'+body)
        reply=self.read(lambda p:p.get('from')==to and 'type' not in p)
        if reply.get('error'):raise RuntimeError(reply.get('message') or reply['error'])
        return reply
    def evaluate(self,console,text):
        rid=self.request(console,'evaluateJSAsync',text=text,mapped={'await':True})['resultID']
        r=self.read(lambda p:p.get('type')=='evaluationResult' and p.get('resultID')==rid)
        if r.get('hasException') or r.get('exception'):raise RuntimeError(str(r.get('exceptionMessage') or 'Firefox script failed'))
        v=r.get('result')
        if isinstance(v,dict) and v.get('type')=='longString':
            return self.request(v['actor'],'substring',start=0,end=v['length'])['substring']
        return v
    def close(self):
        try:self.sock.close()
        except OSError:pass

class FirefoxSession:
    def __init__(self,profile=None,binary=None,check_wait=4,human_wait=180):
        self.profile=Path(profile or profile_dir());self.binary=binary;self.conn=None;self.lock=threading.RLock();self.used=0
        self.check_wait=check_wait;self.human_wait=human_wait;self.waiting_human=False;self.agent_active=False
        threading.Thread(target=self._idle,daemon=True).start()
    def _idle(self):
        while True:
            time.sleep(60)
            with self.lock:
                if self.conn and time.time()-self.used>IDLE_QUIT and not self._browsing():self.quit()
    def _socket(self):return self.profile/'chrome/seanime/control.sock'
    def _connect(self):
        sock=str(self._socket())
        if self.conn:
            try:self.conn.request('root','getRoot');return self.conn
            except (OSError,RuntimeError,ValueError):self.conn.close();self.conn=None
        try:self.conn=Connection(sock);return self.conn
        except OSError:pass
        binary=self.binary or firefox_binary()
        if not binary:raise ValueError('Firefox is not installed. Install it, or pick another torrent source.')
        self._socket().parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        (self.profile/'user.js').write_text(''.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});\n' for k,v in PREFS.items()))
        # uBlock Origin, for this profile only
        xpi=Path(__file__).parent/'ublock-firefox.xpi'
        if xpi.is_file():
            target=self.profile/'extensions/uBlock0@raymondhill.net.xpi'
            target.parent.mkdir(exist_ok=True)
            if not target.is_file() or target.stat().st_size!=xpi.stat().st_size:shutil.copyfile(xpi,target)
        try:self._socket().unlink()
        except OSError:pass
        # --no-remote keeps this from going to the personal Firefox
        subprocess.Popen([binary,'--no-remote','--profile',str(self.profile),'--start-debugger-server',sock],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        end=time.time()+30
        while time.time()<end:
            try:self.conn=Connection(sock);break
            except OSError:time.sleep(.3)
        if not self.conn:raise RuntimeError('Firefox did not start')
        end=time.time()+15
        while time.time()<end:
            try:
                if self._chrome("Services.wm.getMostRecentWindow('navigator:browser')?.gBrowser?1:0")==1:break
            except RuntimeError:pass
            time.sleep(.3)
        self.show(False)
        return self.conn
    def _chrome(self,text):
        process=self.conn.request('root','getProcess',id=0)['processDescriptor']['actor']
        return self.conn.evaluate(self.conn.request(process,'getTarget')['process']['consoleActor'],text)
    def _page(self,text):
        tab=next((t for t in self.conn.request('root','listTabs')['tabs'] if t.get('selected')),None) or self.conn.request('root','listTabs')['tabs'][0]
        return self.conn.evaluate(self.conn.request(tab['actor'],'getTarget')['frame']['consoleActor'],text)
    def _browsing(self):
        """The person has a site open in their own tab"""
        try:return self._chrome("Services.wm.getMostRecentWindow('navigator:browser').gBrowser.tabs.filter(t=>!t.hasAttribute('seanime-side')).length>1")is True
        except (OSError,RuntimeError,ValueError,AttributeError):return False
    def _select(self,index):
        return self._chrome("(()=>{const g=Services.wm.getMostRecentWindow('navigator:browser').gBrowser,old=g.tabs.indexOf(g.selectedTab);g.selectedTab=g.tabs[%d]||g.tabs[0];return old})()"%index)
    def open_site(self,url):
        """Opens a site in its own tab for the person to use, the window stays until they close it."""
        with self.lock:
            self._connect();self.used=time.time()
            self._chrome("(()=>{const g=Services.wm.getMostRecentWindow('navigator:browser').gBrowser;g.selectedTab=g.addTab(%s,{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()})})()"%json.dumps(url))
            self.show(True)
    def show(self,visible):
        self._chrome("for(const w of Services.wm.getEnumerator('navigator:browser')){w.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).visibility=%s;%s}"%('true' if visible else 'false','w.focus()' if visible else ''))
    def _navigate(self,url):
        self._chrome("Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser.fixupAndLoadURIString(%s,{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()})"%json.dumps(url))
    def _state(self):
        for _ in range(3):
            try:
                v=self._page("JSON.stringify({title:document.title,url:location.href,ready:document.readyState})")
                if isinstance(v,str):return json.loads(v)
            except RuntimeError:pass # the page is changing
            time.sleep(1)
        return {'title':'','url':'','ready':''}
    def _load(self,url):
        self._navigate(url);end=time.time()+25;time.sleep(.5)
        while time.time()<end:
            s=self._state()
            if s['ready'] in ('interactive','complete') and s['url'].startswith('http'):return s
            time.sleep(.5)
        return self._state()
    def _pass_check(self):
        """Hidden while a check clears on its own; shown for the person when it does not, hidden after."""
        end=time.time()+self.check_wait
        while time.time()<end:
            if not is_check(self._state()['title']):return
            time.sleep(.5)
        self.show(True);self.waiting_human=True
        try:
            end=time.time()+self.human_wait
            while time.time()<end:
                time.sleep(1)
                s=self._state()
                if s['url'] and s['ready']=='complete' and not is_check(s['title']):return
            raise NeedsHuman('The human check in Firefox was not finished')
        finally:
            self.waiting_human=False;self.show(self._browsing())
    def fetch_all(self,urls):
        """HTML of same-site pages through Firefox's own session, opening the site (and its check) when needed."""
        urls=list(urls)
        if not urls:return []
        with self.lock:
            self._connect();self.used=time.time()
            # The first tab is this session's, the others belong to the person
            back=self._side_tab() if self.agent_active else self._select(0)
            origin=re.match(r'https://[^/]+',urls[0]).group(0)
            if not self._state()['url'].startswith(origin):self._load(urls[0])
            self._pass_check()
            for attempt in range(2):
                out=json.loads(self._page("Promise.all(%s.map(u=>fetch(u,{credentials:'include'}).then(async r=>({s:r.status,t:await r.text()})).catch(()=>({s:0,t:''})))).then(JSON.stringify)"%json.dumps(urls)))
                blocked=next((u for u,r in zip(urls,out) if r['s'] in (403,503) and is_check('',r['t'])),None)
                if not blocked:break
                self._load(blocked);self._pass_check()
            self.used=time.time();self._select(back)
            return [r['t'] if r['s']==200 else '' for r in out]
    def _agent_tab(self):
        """The AI works in the session's own first tab, like every other read, so human checks go the same way"""
        self._connect();self.used=time.time();self._select(0)
    def _side_tab(self):
        """Reads that arrive while the AI is on a page must not take its tab away"""
        return self._chrome("(()=>{const g=Services.wm.getMostRecentWindow('navigator:browser').gBrowser,old=g.tabs.indexOf(g.selectedTab);let t=g.tabs.find(t=>t.hasAttribute('seanime-side'));if(!t){t=g.addTab('about:blank',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});t.setAttribute('seanime-side','1')}g.selectedTab=t;return old})()")
    def agent_load(self,url):
        with self.lock:self._agent_tab();self._load(url)
    def agent_page(self,text):
        with self.lock:
            self._agent_tab()
            try:return self._page(text)
            except RuntimeError:return None # the page is changing
    def agent_pass_check(self,on_wait=None):
        """Exactly the earlier flow: only the title is read until a check has cleared, nothing runs on its page"""
        with self.lock:self._agent_tab()
        end=time.time()+self.check_wait
        while time.time()<end:
            if not is_check(self._state()['title']):return
            time.sleep(.5)
        self.show(True);self.waiting_human=True
        if on_wait:on_wait()
        try:
            end=time.time()+self.human_wait
            while time.time()<end:
                time.sleep(1)
                with self.lock:s=self._state()
                if s['url'] and s['ready']=='complete' and not is_check(s['title']):return
            raise NeedsHuman('The human check in Firefox was not finished')
        finally:
            self.waiting_human=False
            with self.lock:self.show(self._browsing())
    def agent_observe(self):
        v=self.agent_page(OBSERVE_HOLDER['js'])
        return json.loads(v) if isinstance(v,str) else None
    def close_popup(self):
        """Its close button when it has one, otherwise Escape"""
        self.agent_page("(()=>{const c=window.__seanimeCloses||[];if(c[0])c[0].click();else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));return 1})()")
    def wait_human(self):
        """A check inside a normal page: Firefox comes up and only a plain lookup runs until it is gone."""
        with self.lock:self._agent_tab();self.show(True);self.waiting_human=True
        try:
            end=time.time()+self.human_wait
            while time.time()<end:
                time.sleep(3)
                if self.agent_page(OBSERVE_HOLDER['gate'])is False:return
            raise NeedsHuman('The human check in Firefox was not finished')
        finally:
            self.waiting_human=False
            with self.lock:self.show(self._browsing())
    def set_download_dir(self,folder):
        self._connect()
        self._chrome("(()=>{const p=Services.prefs;p.setIntPref('browser.download.folderList',2);p.setCharPref('browser.download.dir',%s);p.setBoolPref('browser.download.useDownloadDir',true);p.setBoolPref('browser.download.always_ask_before_handling_new_types',false);p.setBoolPref('browser.download.alwaysOpenPanel',false);return 1})()"%json.dumps(folder))
    def downloads(self):
        with self.lock:
            self._connect()
            # A promise does not come back through the console, so its answer is left where a second call can read it
            self._chrome("(()=>{globalThis.__seanimeDownloads=null;(async()=>{const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');const l=await Downloads.getList(Downloads.ALL);globalThis.__seanimeDownloads=JSON.stringify((await l.getAll()).map(d=>({path:d.target.path,url:d.source.url,ok:d.succeeded,err:!!d.error,stopped:d.stopped,cur:d.currentBytes,tot:d.totalBytes,started:String(d.startTime)})))})();return 1})()")
            for _ in range(20):
                v=self._chrome("globalThis.__seanimeDownloads")
                if isinstance(v,str):return json.loads(v)
                time.sleep(.1)
        return []
    def start_download(self,url,folder,referrer=''):
        """A file link goes straight to Firefox's downloader, with the session's cookies"""
        name=re.sub(r'[\\/:*?"<>|\x00-\x1f]',' ',os.path.basename(url.split('?')[0].split('#')[0])) or 'video.mp4'
        with self.lock:
            self._connect()
            self._chrome("(async()=>{const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');const d=await Downloads.createDownload({source:{url:%s},target:{path:%s}});(await Downloads.getList(Downloads.ALL)).add(d);d.start().catch(()=>{});return 1})()"%(json.dumps(url),json.dumps(os.path.join(folder,name))))
    def cancel_download(self,path):
        with self.lock:
            self._connect()
            self._chrome("(async()=>{const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');const l=await Downloads.getList(Downloads.ALL);for(const d of await l.getAll())if(d.target.path===%s){await d.finalize(true);await d.removePartialData?.();await l.remove(d);await IOUtils.remove(d.target.path,{ignoreAbsent:true})}return 1})()"%json.dumps(path))
    def shutdown(self):
        """The app is closing. Another request may be holding the lock, so this uses a connection of its own."""
        try:
            self.conn=Connection(str(self._socket()))
            if not self._browsing():self._chrome("Services.startup.quit(Ci.nsIAppStartup.eForceQuit)")
        except (OSError,RuntimeError,ValueError):pass
    def quit(self):
        with self.lock:
            if self.conn:
                try:self._chrome("Services.startup.quit(Ci.nsIAppStartup.eForceQuit)")
                except (OSError,RuntimeError,ValueError):pass
                self.conn.close();self.conn=None
