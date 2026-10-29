"""Reuse the official NativePlayer handler for media-hub playback (exact 3.10.4 patch)."""
from patch_entry_navigation import once

NATIVE_PLAYER_PATH = 'web-denshi/static/js/async/559.73d63145.js'

def patch_native_player(raw):
    text = raw.decode()
    text = once(text,
        'c.useEffect(C,A),(0,b.oA)({type:"native-player",onMessage:e=>{',
        'c.useEffect(C,A),c.useEffect(()=>{window.SeanimeMediaHub?.nativePlayerState?.(Y.active)},[Y.active]),c.useEffect(()=>{window.SeanimeMediaHub?.nativePlayerReady?.(!0);return()=>{delete window.SeanimeNativePlayerMessage;window.SeanimeMediaHub?.nativePlayerReady?.(!1)}},[]),(0,b.oA)({type:"native-player",onMessage:window.SeanimeNativePlayerMessage=e=>{')
    text = once(text,
        'localFile:Y.playbackInfo.localFile,streamType:"native"',
        'localFile:Y.playbackInfo.localFile,streamType:Y.playbackInfo.streamType==="url"&&(/mpegurl/i.test(Y.playbackInfo.mimeType)||/\\.m3u8(?:[?#&]|%3f|%26|$)/i.test(Y.playbackInfo.streamUrl))?"hls":"native"')
    return text.encode()
