"""Keep the current page after successful downloads in the official build."""
from patch_entry_navigation import once
MAGNET_PATH='web-denshi/static/js/async/7322.77c02207.js'
def patch_download_entry(raw):
    text=raw.decode()
    for old,new in [
        ('()=>{C(void 0),N(void 0),a.push("/torrent-list")}','()=>{C(void 0),N(void 0)}'),
        ('()=>{B(!1),U(void 0),j.push("/torrent-list")}','()=>{B(!1),U(void 0)}'),
        ('()=>{B(!1),U(void 0),j.push("/debrid")}','()=>{B(!1),U(void 0)}'),
    ]: text=once(text,old,new)
    return text.encode()
def patch_magnet(raw):
    return once(raw.decode(),'e=()=>{eN.push("/torrent-list")}','e=()=>{}').encode()
def patch_download_bootstrap(raw,magnet_hash):
    return once(raw.decode(),'7322:"77c02207"','7322:"'+magnet_hash+'"').encode()
