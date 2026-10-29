# Built-in Movies and anime sources

The repacked Denshi AppImage includes WebTorrent 3.0.21 and HLS.js 1.6.16, with their lockfile and upstream licenses. Run `npm ci --omit=optional` in this directory before repacking. The node-datachannel prebuilt N-API dependency is included; the AppImage uses Electron's own Node runtime. No separate Node installation is needed by the end user.

The engine binds 127.0.0.1:11437; catalog/subtitle requests use the existing helper at 127.0.0.1:11435. JSON mutations accept local/app origins only. Magnet normalization retains the hash/title and a fixed public tracker list, removing arbitrary tracker and web-seed targets. HTTP file access is indexed by torrent hash and file index, not filesystem paths. Media files are verified by WebTorrent and served with byte-range support. Stopping a transfer disconnects peers and retains downloaded files. Saved jobs resume only after opening Downloads or explicitly playing a saved downloaded title.

Data lives in `${XDG_DATA_HOME:-~/.local/share}/seanime/media-hub`, with torrents under `torrents/`. Movie downloads automatically save their catalog entry and torrent hash in My library. Catalog responses persist for offline fallback; posters use the existing persistent artwork cache once viewed.

Sources are selected from the user-provided Rentry movie and anime pages. YTS supplies movie catalog/release metadata; HydraHD supplies online movie matching and actual embed-server links; AniZone supplies anime metadata, episode HLS playlists and subtitle tracks; Nyaa RSS and AnimeTosho HTML supply additional torrent searches. The old AnimeTosho feed service was unreachable; the HTML provider is used instead. AniZone HLS requests use a proxy confined to its observed suzaku.xin-cdn.xyz host and rewrite playlist URI references. Subtitles are converted to WebVTT and Arabic is preferred when supplied. This player uses provider subtitles, not the previous player's AI translation pipeline.

Movie source players run as cross-origin frames. The packaged Electron popup handler denies new-window requests while a remote subframe is present and prevents it from navigating the app to external websites. Electron's renderer sandbox, context isolation and web security settings are retained. Sites requesting CAPTCHA/verification are not solved; the request fails and another source can be chosen. Domains and hosters may change independently of this build.

Dependency audit: npm reports the ip package advisory through bittorrent-tracker's UDP *server* parser. This build creates a WebTorrent client, not a tracker server, and does not expose that parser as a server endpoint. The magnet tracker list is fixed. No claim of a zero-advisory dependency tree is made.

Tests use a generated local fixture and an actual loopback torrent peer; no third-party movie downloads are needed for the regression suite. Run `node --test test-engine.mjs`.
