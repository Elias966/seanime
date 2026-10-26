"""Fail-closed patch of the official 3.10.4 compiled subtitle manager.

The corresponding readable TS source uses the same queue adapter. Keeping the
rest of the vendor bundle intact avoids rebuilding unrelated application code.
"""
import hashlib
BUNDLE_PATH = 'web-denshi/static/js/async/9195.4d10fc5d.js'


def patch_player_bundle(raw):
    text = raw.decode()
    replacements = [
        ('(0,n.jsx)(as,{}),(0,n.jsx)(tk,{})',
         '(0,n.jsx)(as,{}),(0,n.jsx)("div",{"data-vc-element":"translation-progress-slot",className:"contents"}),(0,n.jsx)(tk,{})'),
        ('topRightSection:(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(tk,{})',
         'topRightSection:(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)("div",{"data-vc-element":"translation-progress-slot",className:"contents"}),(0,n.jsx)(tk,{})'),
        ('this.translateFn=function(e){e.isTranslating=!0,this.sendTranslateRequest?.(e.event.text),this.eventTranslationQueue.set(e.event.text,e)}',
         'this.translateFn=function(e){e.isTranslating=!0,this._queueEventTranslation(e)}'),
        ('this.eventTranslationQueue.clear()', 'this.eventTranslationScheduler?.clear()'),
        ('processEventTranslationQueue(e,t){let a=this.eventTranslationQueue.get(e);a&&(this.eventTranslationQueue.delete(e),a.translatedAssEvent={...a.assEvent,Text:t},a.isTranslating=!1,this.currentTrackNumber===a.event.trackNumber&&this.libassRenderer&&this.libassRenderer.renderer.createEvent(a.translatedAssEvent))}',
         '_queueEventTranslation(e){this._ensureTranslationScheduler().enqueueFormatted(e.assEvent.Text,e)}_ensureTranslationScheduler(){return this.eventTranslationScheduler||=window.SeanimeCreateSubtitleTranslationQueue({send:t=>this.sendTranslateRequest?.(t),getTime:()=>this.videoElement.currentTime*1e3,getStart:e=>e.event.startTime,getEnd:e=>e.event.startTime+e.event.duration,apply:(e,t)=>{e.translatedAssEvent={...e.assEvent,Text:t},e.isTranslating=!1,this.currentTrackNumber===e.event.trackNumber&&this.libassRenderer&&this.libassRenderer.renderer.createEvent(e.translatedAssEvent)}})}_queueFileTranslation(e){let t=this.fileTracks[e];if(!t?.content){this.translatedFileTracks.delete(e);return}this._ensureTranslationScheduler().enqueueAss(t.content,a=>{if(!this.translatedFileTracks.get(e)?.translating)return;if(this.currentTrackNumber!==e){this.translatedFileTracks.delete(e);return}let n=Object.keys(this.fileTracks),i=n.length?Number(n[n.length-1])+1:1000;this.translatedFileTracks.set(i,{translating:!1}),this.addFileTrack({...t.info,index:e,src:"",content:a,type:"ass",language:this.shouldTranslate||"ar",label:`${t.info.label} (translated)`})})}processEventTranslationQueue(e,t){this.eventTranslationScheduler?.accept(e,t)}'),
        ('this.sendTranslateRequest(void 0,t.info)}async _handleFileTrack(e,t)',
         'this._queueFileTranslation(e)}async _handleFileTrack(e,t)'),
        ('return void tI.info("Track has multiple styles, not applying customization");if(this.fileTracks[this.currentTrackNumber]&&(e=!0),!e)return;',
         'return this.libassRenderer.renderer.disableStyleOverride(),void tI.info("Track has multiple styles, not applying customization");if(this.fileTracks[this.currentTrackNumber]){e=!0;if((this.fileTracks[this.currentTrackNumber].content?.match(/^Style:/gm)?.length||0)>1)return void this.libassRenderer.renderer.disableStyleOverride()}if(!e)return;'),
    ]
    for old, new in replacements:
        if text.count(old) != 1:
            raise ValueError('Unexpected subtitle-manager bundle; refusing ambiguous patch')
        text = text.replace(old, new, 1)
    return text.encode()
