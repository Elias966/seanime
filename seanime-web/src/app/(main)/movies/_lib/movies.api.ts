import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/**
 * Movies data layer.
 * - Metadata: Cinemeta (keyless, CORS enabled)
 * - Torrents: YTS through the local media helper (11435)
 * - Streaming/downloading: local torrent engine (11437)
 * - Playback: Seanime's native player (through window.SeanimeMediaHub.play)
 */

const CINEMETA = "https://v3-cinemeta.strem.io"
export const MEDIA_HELPER = "http://127.0.0.1:11435"
export const TORRENT_ENGINE = "http://127.0.0.1:11437"

export const MOVIE_GENRES = [
    "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy",
    "History", "Horror", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western",
] as const

export type Movie_Meta = {
    id: string
    imdb_id?: string
    moviedb_id?: number
    type: "movie"
    name: string
    poster?: string
    background?: string
    logo?: string
    description?: string
    releaseInfo?: string
    year?: string
    released?: string
    runtime?: string
    imdbRating?: string
    genres?: string[]
    genre?: string[]
    cast?: string[]
    director?: string[] | string
    writer?: string[] | string
    country?: string
    awards?: string
    trailers?: { source: string, type: string }[]
    trailerStreams?: { ytId: string, title?: string }[]
}

export type Movie_YtsTorrent = {
    hash: string
    quality: string
    type: string
    video_codec?: string
    audio_channels?: string
    size: string
    size_bytes?: number
    seeds: number
    peers: number
    url?: string
}

export type Movie_YtsItem = {
    id: string
    provider: "yts"
    title: string
    year?: number
    rating?: number
    imdb?: string
    torrents: Movie_YtsTorrent[]
}

export type Movie_ListItem = {
    provider: "cinemeta" | "yts" | "hydra" | "anizone"
    id: string
    imdb?: string
    title: string
    poster?: string
    background?: string
    year?: number | string
    type?: string
    addedAt?: number
}

export type Movie_EngineFile = {
    index: number
    name: string
    length: number
    playable: boolean
    url: string
}

export type Movie_EngineTorrent = {
    hash: string
    title: string
    mode: "stream" | "download"
    error?: string
    ready: boolean
    progress: number
    downloaded: number
    length: number
    downloadSpeed: number
    peers: number
    files: Movie_EngineFile[]
}

declare global {
    interface Window {
        SeanimeMediaHub?: {
            open(kind?: string, query?: string): void
            browse?(id: string, options?: { url?: string, title?: string, autoPlay?: boolean }): Promise<void>
            movieSources?(): Promise<{ id: string, name: string, url: string }[]>
            play?(url: string, title: string, subtitles?: any[], options?: { mimeType?: string }): Promise<void>
        }
        SeanimeNativePlayerMessage?: (message: any) => void
    }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30000) })
    let data: any
    try {
        data = await res.json()
    }
    catch {
    }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
    return data as T
}

const postJson = <T>(url: string, body: unknown) => getJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
})

/** Cinemeta catalog posters are small, upgrade them for the cards. */
export function moviePoster(url?: string, size: "medium" | "large" = "medium") {
    if (!url) return ""
    return url.replace("/poster/small/", `/poster/${size}/`)
}

export function movieBackground(meta?: Pick<Movie_Meta, "id" | "background">) {
    if (!meta) return ""
    if (meta.background) return meta.background.replace(/\/background\/(small|medium)\//, "/background/large/")
    return `https://images.metahub.space/background/large/${meta.id}/img`
}

export function movieYear(meta?: Pick<Movie_Meta, "year" | "releaseInfo" | "released">) {
    const raw = meta?.year || meta?.releaseInfo || meta?.released?.slice(0, 4)
    const n = parseInt(String(raw ?? ""))
    return Number.isFinite(n) ? n : undefined
}

export function movieTrailerId(meta?: Movie_Meta) {
    return meta?.trailerStreams?.[0]?.ytId || meta?.trailers?.find(t => t.type === "Trailer")?.source || meta?.trailers?.[0]?.source
}

/** The hover popup state is keyed by a number, map IMDb ids to a stable negative number so they never collide with AniList ids. */
export function movieNumericId(id: string) {
    const n = parseInt(id.replace(/\D/g, "").slice(-9) || "0")
    return -(n || 1)
}

export function movieLink(id: string) {
    return `/movies/entry?id=${encodeURIComponent(id)}`
}

export function formatBytes(bytes: number) {
    if (!bytes) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Cinemeta
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export type MovieCatalog = { catalog?: "top" | "year", genre?: string, search?: string }

function catalogUrl({ catalog = "top", genre, search }: MovieCatalog, skip = 0) {
    const extras: string[] = []
    if (search) extras.push(`search=${encodeURIComponent(search)}`)
    if (genre) extras.push(`genre=${encodeURIComponent(genre)}`)
    if (skip) extras.push(`skip=${skip}`)
    return `${CINEMETA}/catalog/movie/${catalog}${extras.length ? "/" + extras.join("&") : ""}.json`
}

async function fetchCatalog(c: MovieCatalog, skip = 0) {
    const data = await getJson<{ metas?: Movie_Meta[] }>(catalogUrl(c, skip))
    return (data.metas ?? []).filter(m => m.id?.startsWith("tt") && !!m.poster)
}

export function useMovieCatalog(c: MovieCatalog, enabled = true) {
    return useQuery({
        queryKey: ["movies-catalog", c],
        queryFn: () => fetchCatalog(c),
        enabled,
        staleTime: 1000 * 60 * 30,
    })
}

export function useInfiniteMovieCatalog(c: MovieCatalog, enabled = true) {
    return useInfiniteQuery({
        queryKey: ["movies-catalog-infinite", c],
        queryFn: ({ pageParam }) => fetchCatalog(c, pageParam),
        initialPageParam: 0,
        // Search returns a single page
        getNextPageParam: (last, pages) => (!c.search && last.length > 0) ? pages.reduce((n, p) => n + p.length, 0) : undefined,
        enabled,
        staleTime: 1000 * 60 * 30,
    })
}

export function useMovieMeta(id: string | undefined) {
    return useQuery({
        queryKey: ["movies-meta", id],
        queryFn: async () => {
            const data = await getJson<{ meta?: Movie_Meta }>(`${CINEMETA}/meta/movie/${id}.json`)
            if (!data.meta?.name) throw new Error("Movie not found")
            return data.meta
        },
        enabled: !!id,
        staleTime: 1000 * 60 * 60,
    })
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Media helper (YTS, list)
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export function useMovieTorrents(imdbId: string | undefined) {
    return useQuery({
        queryKey: ["movies-yts", imdbId],
        queryFn: async () => {
            const data = await getJson<{ items: Movie_YtsItem[] }>(
                `${MEDIA_HELPER}/media/catalog?${new URLSearchParams({ provider: "yts", q: imdbId! })}`)
            const item = data.items.find(i => i.imdb === imdbId) ?? data.items[0]
            return item ? item : null
        },
        enabled: !!imdbId,
        retry: 1,
        staleTime: 1000 * 60 * 10,
    })
}

export type Movie_HydraItem = { id: string, title: string, poster?: string }

export function useMovieHydraMatches(title: string | undefined) {
    return useQuery({
        queryKey: ["movies-hydra", title],
        queryFn: async () => {
            const data = await getJson<{ items: Movie_HydraItem[] }>(
                `${MEDIA_HELPER}/media/catalog?${new URLSearchParams({ provider: "hydra", q: title! })}`)
            return data.items ?? []
        },
        enabled: !!title,
        retry: 1,
        staleTime: 1000 * 60 * 10,
    })
}

/** What the streaming websites need to find a movie. */
export type Movie_StreamRef = { tmdb?: number, title: string, year?: number, hydraId?: string }

export type Movie_StreamSource = {
    id: string
    name: string
    /** Registry source the hidden page runs as (its partition, allowed domains and media relay) */
    sourceId: string
    url: (m: Movie_StreamRef) => string | undefined
    /** Element to click once the page is ready, when the site needs it to start the player */
    click?: string
    timeout?: number
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-")
const tmdbUrl = (fn: (tmdb: number, m: Movie_StreamRef) => string) => (m: Movie_StreamRef) => m.tmdb ? fn(m.tmdb, m) : undefined

/** Websites whose player hands Seanime a playable HLS/MP4 stream, fastest first (used in this order by Auto). */
export const MOVIE_STREAM_SOURCES: Movie_StreamSource[] = [
    { id: "vixsrc", name: "VixSrc", sourceId: "hydrahd", url: tmdbUrl(t => `https://vixsrc.to/movie/${t}?autoplay=true`) },
    { id: "rive", name: "Rive", sourceId: "rive", url: tmdbUrl(t => `https://www.rivestream.app/watch?type=movie&id=${t}`) },
    { id: "shiopa", name: "Shiopa", sourceId: "shiopa", url: tmdbUrl(t => `https://shiopa.com/watch/${t}?type=movie`) },
    { id: "redflix", name: "Redflix", sourceId: "redflix", url: tmdbUrl(t => `https://redflix.one/play?id=${t}&type=movie`) },
    { id: "ythd", name: "YTHD", sourceId: "hydrahd", url: tmdbUrl(t => `https://ythd.org/embed/${t}/`) },
    { id: "xpass", name: "XPass", sourceId: "hydrahd", url: tmdbUrl(t => `https://play.xpass.top/e/movie/${t}?autostart=true`) },
    { id: "hydrahd", name: "HydraHD", sourceId: "hydrahd", url: m => m.hydraId && `https://hydrahd.gd/movie/${m.hydraId}`, click: ".ajaxlink_mov0" },
    { id: "latestmovies", name: "LatestMovies", sourceId: "latestmovies", url: tmdbUrl(t => `https://latestmovies.net/watch/movie/${t}`) },
    {
        id: "cinejoy", name: "Cinejoy", sourceId: "cinejoy",
        url: tmdbUrl((t, m) => `https://cinejoy.pk/movie/${t}-${slug(m.title)}${m.year ? "-" + m.year : ""}`),
        timeout: 40000,
    },
    { id: "aether", name: "Aether", sourceId: "aether", url: tmdbUrl((t, m) => `https://aether.cx/media/tmdb-movie-${t}-${slug(m.title)}`), timeout: 40000 },
]

export type Movie_CapturedStream = {
    url: string
    type: "hls" | "video"
    subtitles: { src: string, type: string, label: string, language: string }[]
}

/**
 * Runs inside the website. Starts its player: the site's own button first, then a click on the player itself,
 * then the next "Server N" button. Returns where to click, the clicks are sent as real input events.
 */
function findPlayTarget(step: number, selector: string) {
    const visible = (e: Element) => {
        const r = e.getBoundingClientRect()
        return r.width > 8 && r.height > 8
    }
    const target = (e: Element, what: string) => {
        e.scrollIntoView({ block: "center" })
        const r = e.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), what }
    }
    const label = (e: Element) => ((e as HTMLElement).innerText || e.getAttribute("aria-label") || (e as HTMLElement).title || "").trim()

    document.querySelectorAll("video").forEach(v => {
        v.muted = true
        v.play().catch(() => {})
    })
    if (selector) {
        const e = document.querySelector<HTMLElement>(selector)
        if (e) {
            e.click()
            return { what: "selector" }
        }
    }
    if (step === 0 || step === 2) {
        const b = [...document.querySelectorAll("button,a,[role=button]")]
            .find(b => visible(b) && /^(▶\s*)?(play|play now|watch|watch now|start watching|watch movie|stream now)$/i.test(label(b)))
        if (b) return target(b, "play")
    }
    if (step >= 3) {
        const s = [...document.querySelectorAll<HTMLElement>("button,a,[role=button],li")]
            .find(b => visible(b) && /^(server|source|mirror)\s*\d+$/i.test(label(b)) && !b.dataset.seanimeTried)
        if (s) {
            s.dataset.seanimeTried = "1"
            s.click()
            return { what: "server" }
        }
    }
    const video = [...document.querySelectorAll("video")].find(visible)
    if (video) return target(video, "video")
    const area = (e: Element) => e.getBoundingClientRect().width * e.getBoundingClientRect().height
    const player = [...document.querySelectorAll("iframe,[class*=player i],[id*=player i]")]
        .filter(e => e.getBoundingClientRect().width > 200 && e.getBoundingClientRect().height > 120)
        .sort((a, b) => area(b) - area(a))[0]
    return player ? target(player, player.tagName) : null
}

/**
 * Opens the website in an invisible page and waits for the video stream its player requests.
 * The Electron media relay captures it and returns a local URL the Seanime player can play.
 */
export function captureMovieStream(source: Movie_StreamSource, ref: Movie_StreamRef, signal?: AbortSignal) {
    return new Promise<Movie_CapturedStream>((resolve, reject) => {
        const url = source.url(ref)
        if (!url) return reject(new Error(`${source.name} can't find this movie`))
        if (!window.electron?.on || !window.electron.localServer.allowWebviewOrigin) {
            return reject(new Error("Online streaming needs the Seanime desktop app."))
        }

        const view = document.createElement("webview") as any
        view.setAttribute("partition", "persist:seanime-media-source-" + source.sourceId)
        view.setAttribute("useragent", navigator.userAgent + " SeanimeSource/" + source.sourceId)
        view.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no")
        // Kept on screen (but invisible) so Chromium renders it, players don't start in offscreen pages
        view.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:720px;opacity:0.01;pointer-events:none;z-index:-1;"
        view.setAttribute("src", url)

        let guestId: number | undefined
        let stream: Omit<Movie_CapturedStream, "subtitles"> | undefined
        let done = false
        const subtitles: Movie_CapturedStream["subtitles"] = []
        const timers: ReturnType<typeof setTimeout>[] = []

        const finish = (error?: Error) => {
            if (done) return
            done = true
            timers.forEach(clearTimeout)
            unsubscribe?.()
            signal?.removeEventListener("abort", onAbort)
            view.remove()
            if (error) reject(error)
            else resolve({ ...stream!, subtitles })
        }
        const onAbort = () => finish(new DOMException("Aborted", "AbortError"))
        signal?.addEventListener("abort", onAbort)

        const unsubscribe = window.electron.on("media-source:event", (event: any) => {
            if (!guestId || event.guestId !== guestId) return
            if (event.type === "verification-required") {
                finish(new Error(`${source.name} is asking for a captcha`))
            }
            else if (event.type === "subtitle") {
                if (subtitles.some(s => s.src === event.url)) return
                const label = String(event.label || "")
                const language = /(?:^|[_\W])(ar|ara|arabic)(?:[_\W]|$)/i.test(label) ? "ar"
                    : /(?:^|[_\W])(en|eng|english)(?:[_\W]|$)/i.test(label) ? "en" : ""
                subtitles.push({ src: event.url, type: /\.(ass|ssa|srt|vtt)(?:$|\?)/i.exec(label)?.[1] || "vtt", label: label || "Subtitles", language })
            }
            else if ((event.type === "hls" || event.type === "video") && !stream) {
                stream = { url: event.url, type: event.type }
                // Subtitle requests usually follow the playlist, give them a moment
                timers.push(setTimeout(() => finish(), 1500))
            }
        })

        view.addEventListener("dom-ready", () => {
            try {
                guestId = view.getWebContentsId()
                view.setAudioMuted(true)
            }
            catch {
            }
        })
        const script = `(${findPlayTarget.toString()})`
        ;[3500, 7000, 10500, 14000, 17500, 21000, 26000, 31000].forEach((at, step) => timers.push(setTimeout(async () => {
            if (done || stream) return
            try {
                const p = await view.executeJavaScript(`${script}(${step},${JSON.stringify(source.click ?? "")})`)
                if (p?.x === undefined) return
                for (const type of ["mouseDown", "mouseUp"]) view.sendInputEvent({ type, x: p.x, y: p.y, button: "left", clickCount: 1 })
            }
            catch {
            }
        }, at)))
        timers.push(setTimeout(() => finish(new Error(`${source.name} did not return a video`)), source.timeout ?? 25000))

        // The permission call can stall, don't let it hold the source past its timeout
        const allow = window.electron.localServer.allowWebviewOrigin(new URL(url).origin)
        Promise.race([allow, new Promise(r => setTimeout(r, 3000))]).catch(() => {}).finally(() => !done && document.body.append(view))
    })
}

/** Hands the stream to the Seanime player and resolves once the video is actually playing. */
export async function playCapturedStream(stream: Movie_CapturedStream, title: string, signal?: AbortSignal) {
    if (!window.SeanimeMediaHub?.play) throw new Error("The Seanime player is still loading, try again in a moment.")
    const previous = new Set([...document.querySelectorAll("video")].map(v => v.currentSrc).filter(Boolean))
    await window.SeanimeMediaHub.play(stream.url, title, stream.subtitles,
        { mimeType: stream.type === "hls" ? "application/vnd.apple.mpegurl" : "video/mp4" })
    // Some streams are captured but refuse to load in the player, report them so the next website can be tried
    const started = Date.now()
    while (Date.now() - started < 25000) {
        if (signal?.aborted) return
        const video = [...document.querySelectorAll("video")].find(v => v.currentSrc && !previous.has(v.currentSrc))
        if (video?.error) break
        if (video && video.readyState >= 2 && video.videoWidth > 0) return
        await new Promise(r => setTimeout(r, 500))
    }
    throw new Error("The video from this website would not play")
}

export function useMovieList() {
    return useQuery({
        queryKey: ["movies-list"],
        queryFn: () => getJson<Movie_ListItem[]>(`${MEDIA_HELPER}/media/library`),
        retry: 1,
    })
}

export function useSaveMovieToList() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: ({ item, remove }: { item: Movie_ListItem, remove?: boolean }) =>
            postJson<Movie_ListItem[]>(`${MEDIA_HELPER}/media/library`, remove ? { item, action: "remove" } : { item }),
        onSuccess: data => qc.setQueryData(["movies-list"], data),
    })
}

export function metaToListItem(meta: Movie_Meta): Movie_ListItem {
    return {
        provider: "cinemeta",
        id: meta.id,
        imdb: meta.id,
        title: meta.name,
        poster: moviePoster(meta.poster),
        background: meta.background,
        year: movieYear(meta),
        type: "movie",
        addedAt: Date.now(),
    }
}

/** IMDb id of a list item, list items saved by the old overlay (YTS) carry it in `imdb`. */
export function listItemImdb(item: Movie_ListItem) {
    if (item.provider === "cinemeta") return item.id
    return item.imdb?.startsWith("tt") ? item.imdb : undefined
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Torrent engine
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export function ytsMagnet(hash: string, title: string) {
    return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
}

export const fetchEngineTorrents = () => getJson<Movie_EngineTorrent[]>(`${TORRENT_ENGINE}/torrents`)

export function useEngineTorrents(refetchInterval: number | false = 2000) {
    return useQuery({
        queryKey: ["movies-engine-torrents"],
        queryFn: fetchEngineTorrents,
        refetchInterval,
        retry: false,
    })
}

/** Movie details stored with a download, used to show it in the Library once it finishes. */
export type Movie_LibraryMedia = { imdb: string, title: string, year?: string, poster?: string, background?: string }

export type Movie_LibraryItem = Movie_LibraryMedia & { hash: string, release: string, file: string, size: number, added: number, url: string }

export function metaToLibraryMedia(meta: Movie_Meta): Movie_LibraryMedia {
    return { imdb: meta.id, title: meta.name, year: movieYear(meta)?.toString(), poster: meta.poster, background: meta.background }
}

export function startEngineTorrent(magnet: string, title: string, mode: "stream" | "download", media?: Movie_LibraryMedia) {
    return postJson<{ hash: string }>(`${TORRENT_ENGINE}/torrents`, { magnet, mode, title, media })
}

export function engineAction(action: "stop" | "resume" | "restore" | "library-remove", hash?: string, title?: string, mode?: "stream" | "download") {
    return postJson<unknown>(`${TORRENT_ENGINE}/torrents`, { action, hash, title, mode })
}

export function useMovieLibrary(refetchInterval: number | false = false) {
    return useQuery({
        queryKey: ["movies-library"],
        queryFn: () => getJson<Movie_LibraryItem[]>(`${TORRENT_ENGINE}/library`),
        refetchInterval,
        retry: 1,
    })
}

export function playLibraryItem(item: Movie_LibraryItem) {
    return playMovieUrl(TORRENT_ENGINE + item.url, item.year ? `${item.title} (${item.year})` : item.title)
}

export function largestPlayableFile(t: Movie_EngineTorrent) {
    return t.files.filter(f => f.playable).sort((a, b) => b.length - a.length)[0]
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Playback
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function mimeTypeFor(url: string) {
    if (/\.m3u8(\?|$)/i.test(url)) return "application/vnd.apple.mpegurl"
    if (/\.webm(\?|$)/i.test(url)) return "video/webm"
    return "video/mp4"
}

export async function playMovieUrl(url: string, title: string) {
    if (window.SeanimeMediaHub?.play) {
        return window.SeanimeMediaHub.play(url, title)
    }
    if (typeof window.SeanimeNativePlayerMessage !== "function") {
        throw new Error("The Seanime player is still loading, try again in a moment.")
    }
    window.SeanimeNativePlayerMessage({ type: "open-and-await", payload: `Loading ${title}…` })
    window.SeanimeNativePlayerMessage({
        type: "watch",
        payload: {
            id: "movies-" + Date.now(),
            streamType: "url",
            streamPath: title,
            streamUrl: url,
            mimeType: mimeTypeFor(url),
            contentLength: 0,
            subtitleTracks: [],
            isNakamaWatchParty: false,
        },
    })
}

export function playEngineFile(file: Movie_EngineFile, title: string) {
    return playMovieUrl(TORRENT_ENGINE + file.url, title)
}
