# Built-in Movies and source browsing

The Movies sidebar section provides catalog search, library, downloads and a full Sources registry alongside installed anime extensions. Playback is handed to the existing Seanime NativePlayer/VideoCore, including its subtitle menus, ASS/SRT/VTT renderer and Arabic translation queue. This handoff currently targets NativePlayer; optional MPV Prism is not integrated. Subtitle availability depends on the selected source.

The torrent engine binds **127.0.0.1:11437**, catalog/subtitle/library requests use **11435**, and the Electron source relay binds **11438**. JSON mutations accept local/app origins only. Magnet normalization retains the hash/title and a fixed public tracker list, removing arbitrary tracker/web-seed targets. Torrent-file imports accept only registered capability URLs from the local source relay. Media access is indexed by torrent hash/file index, not arbitrary filesystem paths. WebTorrent verifies pieces and supports byte-range seeking. Stopping retains files and verified .torrent metadata. Explicitly opening Downloads or playing a saved title resumes transfers, including offline playback from retained pieces/metadata.

Files and jobs live under `${XDG_DATA_HOME:-~/.local/share}/seanime/media-hub`. Cached catalog responses and viewed posters remain available offline. Electron's bundled Node runtime runs WebTorrent and its N-API dependency. Python catalog/translation code uses the standard library.

`sources.json` accounts for all relevant streaming, torrent, direct-download and drama headings in the user-provided Rentry pages. Five native catalog adapters coexist with an isolated in-app website browser for other reachable sites. Blocked, closed and unreachable sites remain visible with status; no CAPTCHA solving is added. Reachable HTML is not a playback guarantee. See [all source entries and audit scope](SOURCE-COVERAGE.md).

`media-source-browser.cjs` retains Electron sandbox/context isolation, disables Node/preloads for providers and denies popups/unrelated top-level navigation. Detected media receives opaque loopback capability URLs. The relay restricts upstream destinations to public HTTPS/443 with pinned DNS; redirects and cross-host HLS references do not inherit source cookies/authorization. HLS variants/audio/keys are rewritten and byte ranges proxied. The provider website itself may have ads; the browser is not a universal catalog adapter or a guarantee against hoster changes. Browser-only previews cannot capture Electron webview requests.

## Validation and rebuilding

```sh
npm ci --omit=optional --no-fund --prefix scripts/media-hub
node --test scripts/media-hub/test-engine.mjs scripts/media-hub/test-source-browser.cjs
python3 -m unittest discover -s scripts/media-hub -p 'test_*.py'
```

The engine test uses a loopback peer, verifies seek ranges, retains data after stopping, then resumes offline from cached metadata. Relay fixtures cover network/origin restrictions and HLS credential isolation. `audit_sources.py` builds/audits the registry from saved public HTML snapshots; it records page reachability separately from playback. It does not bypass the raw page's access code or solve verification challenges. Tests are offline fixtures except the local-peer transfer.

The AppImage repacker checks exact official artifact/patch anchors and bundles this directory with dependencies. `scripts/patch_media_player.py` patches the official NativePlayer handler; `scripts/patch_media_electron.py` adds the isolated browser event channel. See [the full repair/build guide](../../docs/arabic-subtitles/README.md).
