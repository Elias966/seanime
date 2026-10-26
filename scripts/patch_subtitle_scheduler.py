"""Fail-closed patch of the official 3.10.4 compiled subtitle manager.

The corresponding readable TS source uses the same queue adapter. Keeping the
rest of the vendor bundle intact avoids rebuilding unrelated application code.
"""
import hashlib
BUNDLE_PATH = 'web-denshi/static/js/async/9195.4d10fc5d.js'


def patch_player_bundle(raw):
    text = raw.decode()
    replacements = [
        ('this.translateFn=function(e){e.isTranslating=!0,this.sendTranslateRequest?.(e.event.text),this.eventTranslationQueue.set(e.event.text,e)}',
         'this.translateFn=function(e){e.isTranslating=!0,this._queueEventTranslation(e)}'),
        ('this.eventTranslationQueue.clear()', 'this.eventTranslationScheduler?.clear()'),
        ('processEventTranslationQueue(e,t){let a=this.eventTranslationQueue.get(e);a&&(this.eventTranslationQueue.delete(e),a.translatedAssEvent={...a.assEvent,Text:t},a.isTranslating=!1,this.currentTrackNumber===a.event.trackNumber&&this.libassRenderer&&this.libassRenderer.renderer.createEvent(a.translatedAssEvent))}',
         '_queueEventTranslation(e){this.eventTranslationScheduler||=window.SeanimeCreateSubtitleTranslationQueue({send:t=>this.sendTranslateRequest?.(t),getTime:()=>this.videoElement.currentTime*1e3,getStart:e=>e.event.startTime,getEnd:e=>e.event.startTime+e.event.duration,apply:(e,t)=>{e.translatedAssEvent={...e.assEvent,Text:t},e.isTranslating=!1,this.currentTrackNumber===e.event.trackNumber&&this.libassRenderer&&this.libassRenderer.renderer.createEvent(e.translatedAssEvent)}}),this.eventTranslationScheduler.enqueue(e.event.text,e)}processEventTranslationQueue(e,t){this.eventTranslationScheduler?.accept(e,t)}'),
    ]
    for old, new in replacements:
        if text.count(old) != 1:
            raise ValueError('Unexpected subtitle-manager bundle; refusing ambiguous patch')
        text = text.replace(old, new, 1)
    return text.encode()
