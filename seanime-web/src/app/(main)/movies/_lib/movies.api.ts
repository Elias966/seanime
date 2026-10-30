import { useSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { TorrentClient_Torrent } from "@/api/generated/types"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import React from "react"

/**
 * Movies data layer.
 * - Metadata: Cinemeta (keyless, CORS enabled)
 * - Torrents: YTS through the local media helper (11435)
 * - Streaming/downloading: local torrent engine (11437)
 * - Playback: Seanime's native player (through window.SeanimeMediaHub.play)
 * - Subtitles: OpenSubtitles through Stremio's public add-on (keyless, CORS enabled)
 */

const CINEMETA = "https://v3-cinemeta.strem.io"
const OPENSUBTITLES = "https://opensubtitles-v3.strem.io"
export const MEDIA_HELPER = "http://127.0.0.1:11435"
export const TORRENT_ENGINE = "http://127.0.0.1:11437"

export const MOVIE_GENRES = [
    "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy",
    "History", "Horror", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western",
] as const

/** Cinemeta's series genres. "Cartoons" are its Animation genre. */
export const SERIES_GENRES = [
    "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "History", "Horror",
    "Mystery", "Reality-TV", "Romance", "Sci-Fi", "Talk-Show", "Thriller", "War", "Western",
] as const

export type Movie_Video = {
    id: string
    name?: string
    title?: string
    season: number
    episode?: number
    number?: number
    released?: string
    thumbnail?: string
    overview?: string
    description?: string
}

export type Movie_Meta = {
    id: string
    imdb_id?: string
    moviedb_id?: number
    type: "movie" | "series"
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
    /** Series only: every episode */
    videos?: Movie_Video[]
    status?: string
}

export type Movie_YtsTorrent = {
    /** The release's own name, 1337x only */
    name?: string
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
    provider: "cinemeta" | "yts" | "hydra" | "anizone" | "kisskh"
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
    media?: Movie_LibraryMedia
    /** Series downloads: the folder under <library>/Series, and whether it waits for a free transfer */
    folder?: string
    queued?: boolean
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

export function movieLink(id: string, type: Movie_Meta["type"] = "movie") {
    if (id.startsWith(KISSKH_PREFIX)) return `/series/entry?drama=${encodeURIComponent(id.slice(KISSKH_PREFIX.length))}`
    return `/${type === "series" ? "series" : "movies"}/entry?id=${encodeURIComponent(id)}`
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

export type MovieCatalog = { type?: "movie" | "series", catalog?: "top" | "year", genre?: string, search?: string }

function catalogUrl({ type = "movie", catalog = "top", genre, search }: MovieCatalog, skip = 0) {
    const extras: string[] = []
    if (search) extras.push(`search=${encodeURIComponent(search)}`)
    if (genre) extras.push(`genre=${encodeURIComponent(genre)}`)
    if (skip) extras.push(`skip=${skip}`)
    return `${CINEMETA}/catalog/${type}/${catalog}${extras.length ? "/" + extras.join("&") : ""}.json`
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

/** Years Cinemeta has a catalog for, newest first */
export function browseYears(type: "movie" | "series") {
    const first = type === "movie" ? 1920 : 1960
    return Array.from({ length: new Date().getFullYear() - first + 1 }, (_, i) => String(new Date().getFullYear() - i))
}

/**
 * Browse results for a genre, a year or both. Cinemeta's catalogs filter by one of them only, so with both
 * the year's catalog is filtered here, loading further pages until there are enough to show.
 */
export function useBrowseCatalog(type: "movie" | "series", genre: string | undefined, year: string | undefined, search: string, enabled = true) {
    const query = useInfiniteMovieCatalog(
        search ? { type, catalog: "top", search }
            : year ? { type, catalog: "year", genre: year }
            : { type, catalog: "top", genre }, enabled)
    const metas = React.useMemo(() => (query.data?.pages.flat() ?? []).filter(m => search
        ? !year || movieYear(m) === Number(year)
        : !year || !genre || !!m.genres?.includes(genre)), [query.data, search, year, genre])
    const filtering = !search && !!year && !!genre
    const more = filtering && metas.length < 24 && !!query.hasNextPage && (query.data?.pages.length ?? 0) < 20
    React.useEffect(() => {
        if (more && !query.isFetchingNextPage) query.fetchNextPage()
    }, [more, query.isFetchingNextPage])
    return { ...query, metas, isLoading: query.isLoading || (more && !metas.length) }
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

export async function fetchMovieMeta(id: string, type: Movie_Meta["type"] = "movie") {
    const data = await getJson<{ meta?: Movie_Meta }>(`${CINEMETA}/meta/${type}/${id}.json`)
    if (!data.meta?.name) throw new Error(type === "series" ? "Series not found" : "Movie not found")
    return data.meta
}

export function useMovieMeta(id: string | undefined, type: Movie_Meta["type"] = "movie") {
    return useQuery({
        queryKey: ["movies-meta", id, type],
        queryFn: () => fetchMovieMeta(id!, type),
        enabled: !!id,
        staleTime: 1000 * 60 * 60,
    })
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Media helper (YTS, list)
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/** Which torrent source a kind of content uses, remembered for next time. 1337x is the default. */
export function useTorrentSource<T extends string>(kind: "movies" | "series" | "series-play", fallback: T) {
    const key = `sea-torrent-source-${kind}`
    const [source, setSource] = React.useState<T>(() => {
        try {
            return (localStorage.getItem(key) as T) || fallback
        }
        catch {
            return fallback
        }
    })
    const change = (value: T) => {
        setSource(value)
        try {
            localStorage.setItem(key, value)
        }
        catch {
        }
    }
    return [source, change] as const
}

// Long enough for the person to finish a human check when Firefox asks for one
const HUMAN_CHECK_WAIT = 240000

export function useMovie1337xTorrents(title: string | undefined, year: number | string | undefined) {
    return useQuery({
        queryKey: ["movies-1337x", title, year],
        queryFn: () => getJson<Movie_YtsTorrent[]>(`${MEDIA_HELPER}/media/movie-torrents?${new URLSearchParams({ title: title!, year: String(year ?? "") })}`,
            { signal: AbortSignal.timeout(HUMAN_CHECK_WAIT) }),
        enabled: !!title,
        retry: 0,
        staleTime: 1000 * 60 * 10,
    })
}

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
export type Movie_StreamRef = {
    imdb?: string, tmdb?: number, title: string, year?: number, hydraId?: string
    /** Series episodes */
    season?: number, episode?: number
    /** kisskh episodes: the drama and episode ids */
    drama?: { id: string, episodeId: number, title: string }
}

export type Movie_StreamSource = {
    id: string
    name: string
    /** Registry source the hidden page runs as (its partition, allowed domains and media relay) */
    sourceId: string
    url: (m: Movie_StreamRef) => string | undefined
    /** Element to click once the page is ready, when the site needs it to start the player */
    click?: string
    /** The site's servers to try first (by name), when its default one is slow or often broken */
    servers?: RegExp
    /** Hosts whose streams are too slow to play (a site's own proxy): the next server is tried instead */
    slowHosts?: RegExp
    timeout?: number
    /** For sites without predictable addresses: finds the page to play (usually through the site's search) */
    resolve?: (m: Movie_StreamRef, signal: AbortSignal) => Promise<string | undefined>
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
    { id: "1shows", name: "1Shows", sourceId: "1shows", url: tmdbUrl((t, m) => `https://www.1shows.org/movies/${t}-${slug(m.title)}`) },
    { id: "huzske", name: "Huzske", sourceId: "huzske", url: tmdbUrl((t, m) => `https://huzske.com/?route=${encodeURIComponent(`movie/${slug(m.title)}-${t}/watch`)}`) },
    { id: "cinezo", name: "Cinezo", sourceId: "cinezo", url: tmdbUrl(t => `https://cinezo.st/watch/movie/${t}`) },
    { id: "vidlink", name: "VidLink", sourceId: "bingeflix", url: tmdbUrl(t => `https://vidlink.pro/movie/${t}`) },
]

const tvUrl = (fn: (tmdb: number, s: number, e: number) => string) => (m: Movie_StreamRef) =>
    m.tmdb && m.season !== undefined && m.episode !== undefined ? fn(m.tmdb, m.season, m.episode) : undefined

/** The same websites, for a series episode (by TMDB id, season and episode). Cinezo is left out: its episodes come as DASH, which the player does not take. */
export const SERIES_STREAM_SOURCES: Movie_StreamSource[] = [
    { id: "vixsrc", name: "VixSrc", sourceId: "hydrahd", url: tvUrl((t, s, e) => `https://vixsrc.to/tv/${t}/${s}/${e}?autoplay=true`) },
    { id: "rive", name: "Rive", sourceId: "rive", url: tvUrl((t, s, e) => `https://www.rivestream.app/watch?type=tv&id=${t}&season=${s}&episode=${e}`) },
    { id: "xpass", name: "XPass", sourceId: "hydrahd", url: tvUrl((t, s, e) => `https://play.xpass.top/e/tv/${t}/${s}/${e}?autostart=true`) },
    { id: "latestmovies", name: "LatestMovies", sourceId: "latestmovies", url: tvUrl((t, s, e) => `https://latestmovies.net/watch/tv/${t}/${s}/${e}`) },
]

/** kisskh's episode page starts its player by itself. */
/** AsiaFlix names its pages after the title: /drama/lovely-runner/episode-1 */
const asiaflixSlug = (title: string) => title.replace(/\s*\(\d{4}\)\s*$/, "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
export const ASIAFLIX_STREAM_SOURCE: Movie_StreamSource = {
    id: "asiaflix", name: "AsiaFlix", sourceId: "asiaflix", timeout: 45000,
    // Its own "Asiaflix" servers go through a slow proxy, the "Primary" ones usually play straight from the video host
    servers: /^primary\b/i,
    slowHosts: /^hlsproxy[\w-]*\.asiaflix\./i,
    url: m => m.drama && `https://asiaflix.net/drama/${asiaflixSlug(m.drama.title)}/episode-${m.episode ?? 1}`,
}

export const KISSKH_STREAM_SOURCE: Movie_StreamSource = {
    id: "kisskh", name: "kisskh", sourceId: "kisskh", timeout: 35000,
    url: m => m.drama && `https://kisskh.co/Drama/${encodeURIComponent(m.drama.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-"))}/Episode-${m.episode ?? 1}?id=${m.drama.id}&ep=${m.drama.episodeId}&page=0&pageSize=100`,
}

export type Movie_CapturedStream = {
    url: string
    type: "hls" | "video"
    subtitles: { src: string, type: string, label: string, language: string }[]
}

/**
 * Runs inside the website. Starts its player: the site's own button first, then a click on the player itself
 * (servers are switched by pageServers). Returns where to click, the clicks are sent as real input events.
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
    const video = [...document.querySelectorAll("video")].find(visible)
    if (video) return target(video, "video")
    const area = (e: Element) => e.getBoundingClientRect().width * e.getBoundingClientRect().height
    const player = [...document.querySelectorAll("iframe,[class*=player i],[id*=player i]")]
        .filter(e => e.getBoundingClientRect().width > 200 && e.getBoundingClientRect().height > 120)
        .sort((a, b) => area(b) - area(a))[0]
    return player ? target(player, player.tagName) : null
}

/**
 * Runs a script in a hidden website page. It goes through the app's main process, which runs it in the page's main
 * frame right away: the webview's own executeJavaScript waits for the page to finish loading, and pages full of
 * ads never do.
 */
function runInPage<T = any>(view: any, code: string, timeout = 4000, allFrames = false) {
    return new Promise<T>((resolve, reject) => {
        let guestId: number
        try {
            guestId = view.getWebContentsId()
        }
        catch {
            return reject(new Error("The page is not ready"))
        }
        const electron = window.electron as any
        if (!electron?.emit || !electron?.on) {
            const timer = setTimeout(() => reject(new Error("The page did not answer")), timeout)
            view.executeJavaScript(code).then((r: T) => resolve(allFrames ? [r] as T : r), reject).finally(() => clearTimeout(timer))
            return
        }
        const id = crypto.randomUUID()
        const stop = electron.on("media-source:event", (event: any) => {
            if (event?.type !== "run-result" || event.id !== id) return
            clearTimeout(timer)
            stop?.()
            if (event.error) reject(new Error(event.error))
            else resolve(event.result)
        })
        const timer = setTimeout(() => {
            stop?.()
            reject(new Error("The page did not answer"))
        }, timeout)
        electron.emit("media-source:run", { guestId, id, code, allFrames })
    })
}

/**
 * Runs inside the website. Finds the site's server list (a dropdown or "Server N" style buttons) and, when `pick`
 * is a list position, switches to that server. Returns the server names and which one is selected (-1 for none).
 */
function pageServers(pick: number) {
    const name = (e: Element) => ((e as HTMLElement).innerText || e.textContent || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")
    const server = /server|source\s*\d|primary|backup|mirror|\bhost|\bcdn\b|vidplay|upcloud|megacloud|vidcloud|streamwish|filemoon|dood|mixdrop|streamtape|\bvoe\b|mp4upload|high quality/i
    const notServer = /^(episode|season|ep|part|sort|language)\b/i
    const select = [...document.querySelectorAll("select")].find(s => {
        const o = [...s.options].filter(o => o.value !== "")
        return o.length >= 2 && o.filter(o => server.test(name(o)) && !notServer.test(name(o))).length * 2 > o.length
    })
    if (select) {
        const options = [...select.options].filter(o => o.value !== "")
        if (pick >= 0 && options[pick]) {
            select.value = options[pick].value
            select.dispatchEvent(new Event("input", { bubbles: true }))
            select.dispatchEvent(new Event("change", { bubbles: true }))
        }
        return { labels: options.map(name), active: options.findIndex(o => o.value === select.value) }
    }
    const visible = (e: Element) => e.getBoundingClientRect().width > 8 && e.getBoundingClientRect().height > 8
    const seen = new Set<string>()
    const buttons = [...document.querySelectorAll<HTMLElement>("button,a,[role=button],[role=tab],li,[data-server],[data-link]")]
        .filter(b => {
            const n = name(b)
            if (!visible(b) || n.length > 40 || notServer.test(n) || !server.test(n) || b.querySelector("button,a,li") || seen.has(n)) return false
            seen.add(n)
            return true
        })
    if (buttons.length < 2) return { labels: [] as string[], active: -1 }
    if (pick >= 0 && buttons[pick]) buttons[pick].click()
    const active = pick >= 0 ? pick : buttons.findIndex(b => /\b(active|selected|current|on)\b/i.test(b.className) || b.getAttribute("aria-selected") === "true")
    return { labels: buttons.map(name), active }
}

/** What video hosts show in their player when the file is gone */
const DEAD_FILE = /file (is no longer available|was deleted|has been (deleted|removed)|not found)|video (not found|is unavailable|has been removed)|no longer available|this file (doesn't|does not) exist|sorry, (this|the) (video|file)/i
const DEAD_FILE_CHECK = "(document.body ? document.body.innerText.slice(0, 400) : '')"

export type Movie_StreamServers = {
    /** The website's server names for this episode or movie */
    labels: string[]
    active: number
    /** Switches the website to another server while it is still looking for the video */
    pick: (index: number) => void
}

const serverKey = (sourceId: string) => "seanime-stream-server-" + sourceId

/** The server last chosen on a website, tried first the next time it plays */
export function rememberServer(sourceId: string, label?: string) {
    try {
        if (label) localStorage.setItem(serverKey(sourceId), label)
        else localStorage.removeItem(serverKey(sourceId))
    }
    catch {
    }
}

/**
 * Opens the website in an invisible page and waits for the video stream its player requests.
 * The Electron media relay captures it and returns a local URL the Seanime player can play.
 */
/** Playlists before video files, then the first one the relay can still load. */
async function pickStream(streams: Omit<Movie_CapturedStream, "subtitles">[]) {
    const ordered = [...streams.filter(s => s.type === "hls"), ...streams.filter(s => s.type === "video")]
    for (const s of ordered) {
        try {
            // The relay passes a range on to the CDN, so only video files are asked for their first byte
            const res = await fetch(s.url, { headers: s.type === "video" ? { Range: "bytes=0-0" } : {}, signal: AbortSignal.timeout(8000) })
            res.body?.cancel()
            if (res.ok) return s
        }
        catch {
        }
    }
    return ordered[0]
}

export function captureMovieStream(source: Movie_StreamSource, ref: Movie_StreamRef, signal?: AbortSignal,
    onServers?: (servers: Movie_StreamServers) => void) {
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
        // Every stream the page loads, ads and spent one-time playlists included, the first one that replays is used
        const streams: Omit<Movie_CapturedStream, "subtitles">[] = []
        let stream: Omit<Movie_CapturedStream, "subtitles"> | undefined
        let done = false
        const subtitles: Movie_CapturedStream["subtitles"] = []
        const timers: ReturnType<typeof setTimeout>[] = []

        const finish = (error?: Error) => {
            if (done) return
            done = true
            timers.forEach(t => {
                clearTimeout(t)
                clearInterval(t)
            })
            unsubscribe?.()
            signal?.removeEventListener("abort", onAbort)
            view.remove()
            if (error) reject(error)
            else pickStream(streams).then(s => resolve({ ...s, subtitles }))
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
                subtitles.push({ src: event.url, type: /\.(ass|ssa|srt|vtt)(?:\.txt\d?)?(?:$|\?)/i.exec(label)?.[1] || "vtt", label: label || "Subtitles", language })
            }
            else if (event.type === "hls" || event.type === "video") {
                if (source.slowHosts?.test(String(event.originalHost ?? ""))) {
                    slowSeen = true
                    if (!stream && !chosenByUser && servers.labels.length > 1) {
                        switchServer((servers.active + 1) % servers.labels.length)
                        lastSwitch = Date.now()
                    }
                    return
                }
                streams.push({ url: event.url, type: event.type })
                if (stream) return
                stream = streams[0]
                // Subtitle requests usually follow the playlist, give them a moment. A plain video file may be an ad
                // that played before the episode, so the episode's playlist gets longer to show up.
                timers.push(setTimeout(() => finish(), event.type === "hls" ? 1500 : 5000))
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
        // The player is poked every few seconds until it plays; a server switch starts the steps over
        let clickStep = 0
        let clickBusy = false
        const clicks = setInterval(async () => {
            if (done || stream) return clearInterval(clicks)
            if (clickBusy) return
            clickBusy = true
            try {
                const p = await runInPage(view, `${script}(${clickStep++},${JSON.stringify(source.click ?? "")})`)
                if (p?.x !== undefined) for (const type of ["mouseDown", "mouseUp"]) view.sendInputEvent({ type, x: p.x, y: p.y, button: "left", clickCount: 1 })
            }
            catch {
            }
            clickBusy = false
        }, 3500)
        timers.push(clicks)
        let slowSeen = false
        const noVideo = (what: string) => new Error(slowSeen ? `${what} only answered through its slow proxy, choose another server or source` : `${what} did not return a video`)
        let deadline = setTimeout(() => finish(noVideo(source.name)), source.timeout ?? 25000)
        timers.push(deadline)

        // Sites list several servers per episode. The one remembered for this site is picked, then the next one each
        // time a server gives nothing; picking one by hand stops that.
        let servers = { labels: [] as string[], active: -1 }
        let chosenByUser = false
        const report = () => onServers?.({ ...servers, pick: i => switchServer(i, true) })
        const runServers = async (pick: number) => {
            try {
                const r = await runInPage(view, `(${pageServers.toString()})(${pick})`)
                if (r && Array.isArray(r.labels)) servers = { labels: r.labels.map(String), active: pick >= 0 ? pick : r.active }
            }
            catch {
            }
            report()
        }
        const switchServer = (i: number, byUser = false) => {
            if (done || stream || i < 0 || i >= servers.labels.length) return
            if (byUser) {
                chosenByUser = true
                rememberServer(source.id, servers.labels[i])
                // A server picked by hand gets its own full wait
                clearTimeout(deadline)
                deadline = setTimeout(() => finish(noVideo(`${servers.labels[i]} on ${source.name}`)), source.timeout ?? 25000)
                timers.push(deadline)
            }
            streams.length = 0
            clickStep = 0
            runServers(i)
        }
        // The server list can show up late on script-rendered pages, so it is looked for until it is there. A page
        // that lists servers without picking one usually picks its own default soon, otherwise the first is used.
        let foundAt = 0
        let lastSwitch = 0
        const serverStep = Math.max(10000, Math.floor((source.timeout ?? 25000) / 4))
        const watchServers = setInterval(async () => {
            if (done || stream) return clearInterval(watchServers)
            if (!servers.labels.length) {
                await runServers(-1)
                if (!servers.labels.length) return
                foundAt = lastSwitch = Date.now()
                let remembered = -1
                try {
                    remembered = servers.labels.indexOf(localStorage.getItem(serverKey(source.id)) ?? "")
                }
                catch {
                }
                if (remembered < 0 && source.servers && !source.servers.test(servers.labels[servers.active] ?? "")) {
                    remembered = servers.labels.findIndex(l => source.servers!.test(l))
                }
                if (remembered >= 0 && remembered !== servers.active) switchServer(remembered)
                return
            }
            if (chosenByUser) return
            // A server whose file is gone says so in its player, the next one is tried right away
            let dead = false
            if (servers.active >= 0 && Date.now() - lastSwitch > 2500) try {
                const texts = await runInPage<(string | null)[]>(view, DEAD_FILE_CHECK, 3000, true)
                dead = texts.some(t => !!t && DEAD_FILE.test(t))
            }
            catch {
            }
            if (done || stream) return
            if (dead && servers.labels.length > 1) {
                switchServer((servers.active + 1) % servers.labels.length)
                lastSwitch = Date.now()
            }
            else if (servers.active < 0 && Date.now() - foundAt > 6000) {
                await runServers(-1)
                if (servers.active < 0) switchServer(0)
                lastSwitch = Date.now()
            }
            else if (servers.labels.length > 1 && Date.now() - lastSwitch > serverStep) {
                switchServer((servers.active + 1) % servers.labels.length)
                lastSwitch = Date.now()
            }
        }, 2000)
        timers.push(watchServers)

        // The permission call can stall, don't let it hold the source past its timeout
        const allow = window.electron.localServer.allowWebviewOrigin(new URL(url).origin)
        Promise.race([allow, new Promise(r => setTimeout(r, 3000))]).catch(() => {}).finally(() => !done && document.body.append(view))
    })
}

/**
 * Opens a website page (usually its search results) in an invisible page and returns the first link that `pick`
 * accepts from the links on it, waiting for script-rendered results.
 */
export function findPageLink(pageUrl: string, sourceId: string, pick: (links: { href: string, text: string }[]) => string | undefined,
    signal?: AbortSignal, timeout = 20000) {
    return new Promise<string | undefined>(resolve => {
        if (!window.electron?.localServer?.allowWebviewOrigin) return resolve(undefined)
        const view = document.createElement("webview") as any
        view.setAttribute("partition", "persist:seanime-media-source-" + sourceId)
        view.setAttribute("useragent", navigator.userAgent + " SeanimeSource/" + sourceId)
        view.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no")
        view.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:720px;opacity:0.01;pointer-events:none;z-index:-1;"
        view.setAttribute("src", pageUrl)
        let done = false
        const finish = (url?: string) => {
            if (done) return
            done = true
            clearInterval(poll)
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
            view.remove()
            resolve(url)
        }
        const onAbort = () => finish()
        signal?.addEventListener("abort", onAbort)
        const poll = setInterval(async () => {
            try {
                const links = await runInPage(view,
                    "[...document.querySelectorAll('a[href]')].map(a=>({href:a.href,text:(a.innerText||a.title||'').trim()}))")
                const url = pick(links)
                if (url) finish(url)
            }
            catch {
            }
        }, 1500)
        const timer = setTimeout(() => finish(), timeout)
        const allow = window.electron.localServer.allowWebviewOrigin(new URL(pageUrl).origin)
        Promise.race([allow, new Promise(r => setTimeout(r, 3000))]).catch(() => {}).finally(() => !done && document.body.append(view))
    })
}

/** Hands the stream to the Seanime player and resolves once the video is actually playing. */
export async function playCapturedStream(stream: Movie_CapturedStream, title: string, signal?: AbortSignal, imdb?: string) {
    if (!window.SeanimeMediaHub?.play) throw new Error("The Seanime player is still loading, try again in a moment.")
    const previous = new Set([...document.querySelectorAll("video")].map(v => v.currentSrc).filter(Boolean))
    // The website's own subtitles come first, OpenSubtitles fills in the languages it does not have
    const own = new Set(stream.subtitles.map(s => s.language.slice(0, 2).toLowerCase()))
    const extra = (await fetchMovieSubtitles(imdb)).filter(s => !own.has(s.language.slice(0, 2)))
    if (signal?.aborted) return
    await window.SeanimeMediaHub.play(stream.url, title, [...stream.subtitles, ...extra],
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
    if (meta.id.startsWith(KISSKH_PREFIX)) return {
        provider: "kisskh",
        id: meta.id.slice(KISSKH_PREFIX.length),
        title: meta.name,
        poster: meta.poster,
        year: movieYear(meta),
        type: "series",
        addedAt: Date.now(),
    }
    return {
        provider: "cinemeta",
        id: meta.id,
        imdb: meta.id,
        title: meta.name,
        poster: moviePoster(meta.poster),
        background: meta.background,
        year: movieYear(meta),
        type: meta.type,
        addedAt: Date.now(),
    }
}

/** IMDb id of a list item, list items saved by the old overlay (YTS) carry it in `imdb`. */
export function listItemImdb(item: Movie_ListItem) {
    if (item.provider === "cinemeta") return item.id
    return item.imdb?.startsWith("tt") ? item.imdb : undefined
}

/** A list item as card data (Cinemeta and kisskh items, the ones without an IMDb id are skipped). */
export function listItemMeta(item: Movie_ListItem): Movie_Meta | undefined {
    if (item.provider === "kisskh") return {
        id: KISSKH_PREFIX + item.id, type: "series", name: item.title, poster: item.poster, background: item.poster,
        year: item.year ? String(item.year) : undefined,
    }
    const id = listItemImdb(item)
    if (!id) return undefined
    return {
        id,
        type: item.type === "series" ? "series" : "movie",
        name: item.title,
        poster: item.poster || `https://images.metahub.space/poster/medium/${id}/img`,
        background: item.background,
        year: item.year ? String(item.year) : undefined,
    }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// kisskh (East / South Asian dramas, through the media helper since its API has no CORS headers)
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/** Card ids of kisskh dramas, so they never collide with IMDb ids. */
export const KISSKH_PREFIX = "kisskh:"

/** type: 1 TV series, 2 movies. status: 0 all, 1 ongoing, 2 completed. tag: a Dramaday genre tag id (Korean titles, newest first) */
export type Drama_Catalog = { country?: number, order?: number, type?: number, status?: number, search?: string, tag?: number }
export type Drama_Item = { id: string, provider: "kisskh", title: string, poster?: string, episodes?: number }
export type Drama_Detail = {
    id: number, title: string, description?: string, country?: string, status?: string, type?: string, releaseDate?: string,
    thumbnail?: string, episodesCount?: number, episodes: { id: number, number: number, sub?: number }[]
}

/** Genre value that switches a series list to kisskh's Asian dramas */
export const ASIAN_DRAMA_GENRE = "Asian Drama"
/** Series genres with Asian Drama listed after Drama */
export const SERIES_GENRES_WITH_DRAMAS: string[] = SERIES_GENRES.flatMap(g => g === "Drama" ? [g, ASIAN_DRAMA_GENRE] : [g])

export const DRAMA_COUNTRIES = [
    { id: 0, name: "All" }, { id: 2, name: "Korean" }, { id: 1, name: "Chinese" }, { id: 3, name: "Japanese" },
    { id: 4, name: "Hong Kong" }, { id: 5, name: "Thai" }, { id: 6, name: "Taiwanese" }, { id: 7, name: "Philippine" },
] as const

export function dramaMeta(d: Drama_Item): Movie_Meta {
    return { id: KISSKH_PREFIX + d.id, type: "series", name: d.title, poster: d.poster, background: d.poster }
}

const fetchDramas = (c: Drama_Catalog, page = 1) => getJson<{ items: Drama_Item[], total: number }>(`${MEDIA_HELPER}/media/catalog?${new URLSearchParams({
    provider: "kisskh", page: String(page), country: String(c.country ?? 0), order: String(c.order ?? 1), type: String(c.type ?? 1), status: String(c.status ?? 0), q: c.search ?? "",
    genre: c.tag ? String(c.tag) : "",
})}`)

/** Prequels, sequels, spin-offs and titles of the same series or franchise, from Wikidata */
export type Movie_Related = { imdb: string, name: string, relation: string, type: "movie" | "series", year: string }

export function useRelatedTitles(imdb: string | undefined) {
    return useQuery({
        queryKey: ["related-titles", imdb],
        queryFn: () => getJson<Movie_Related[]>(`${MEDIA_HELPER}/media/related?${new URLSearchParams({ imdb: imdb! })}`),
        enabled: !!imdb && /^tt\d+$/.test(imdb),
        retry: 1,
        staleTime: 1000 * 60 * 60,
    })
}

/** A drama's name without its season or part ("Hospital Playlist 2" -> "Hospital Playlist") */
export const dramaBaseTitle = (t: string) => t.replace(/\s*[:(-]?\s*(season|part)\s*\d+\)?\s*$/i, "").replace(/\s+\d{1,2}$/, "").replace(/\s*\(\d{4}\)$/, "").trim()

export function useDramaCatalog(c: Drama_Catalog, enabled = true) {
    return useQuery({
        queryKey: ["dramas-catalog", c],
        queryFn: async () => (await fetchDramas(c)).items.map(dramaMeta),
        enabled,
        staleTime: 1000 * 60 * 30,
    })
}

export function useInfiniteDramaCatalog(c: Drama_Catalog, enabled = true) {
    return useInfiniteQuery({
        queryKey: ["dramas-catalog-infinite", c],
        queryFn: async ({ pageParam }) => (await fetchDramas(c, pageParam)).items.map(dramaMeta),
        initialPageParam: 1,
        getNextPageParam: (last, pages) => (!c.search && last.length > 0) ? pages.length + 1 : undefined,
        enabled,
        staleTime: 1000 * 60 * 30,
    })
}

const normalTitle = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim()

/** The Cinemeta series a kisskh drama is, so the series websites can play it too. "Title Season 2" is season 2 of "Title". */
export async function matchDrama(d: Drama_Detail): Promise<{ imdb: string, tmdb?: number, season: number } | undefined> {
    const seasonMatch = d.title.match(/\s+Season\s+(\d+)\s*$/i)
    const base = d.title.replace(/\s+Season\s+\d+\s*$/i, "").replace(/\s*\(\d{4}\)\s*$/, "").trim()
    const year = Number(d.releaseDate?.slice(0, 4)) || undefined
    const results = await fetchCatalog({ type: "series", catalog: "top", search: base })
    const named = results.filter(m => normalTitle(m.name) === normalTitle(base))
    // kisskh's date is when it was added, which can be a year off the first air date
    const start = (m: Movie_Meta) => Number(m.releaseInfo?.slice(0, 4)) || 0
    const best = (year && !seasonMatch && named.find(m => Math.abs(start(m) - year) <= 1)) || named[0]
    if (!best) return undefined
    const meta = await fetchMovieMeta(best.id, "series").catch(() => undefined)
    return { imdb: best.id, tmdb: meta?.moviedb_id, season: seasonMatch ? Number(seasonMatch[1]) : 1 }
}

export function useDramaMatch(d: Drama_Detail | undefined) {
    return useQuery({
        queryKey: ["dramas-match", d?.id],
        queryFn: () => matchDrama(d!).then(m => m ?? null),
        enabled: !!d,
        staleTime: 1000 * 60 * 60 * 24,
    })
}

export function useDramaDetail(id: string | undefined) {
    return useQuery({
        queryKey: ["dramas-detail", id],
        queryFn: () => getJson<Drama_Detail>(`${MEDIA_HELPER}/media/drama?${new URLSearchParams({ id: id! })}`),
        enabled: !!id,
        staleTime: 1000 * 60 * 30,
    })
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Torrent engine
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export function ytsMagnet(hash: string, title: string) {
    return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
}

// Other torrent clients need trackers to find peers quickly, a bare hash can wait a long time for metadata
const CLIENT_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "https://tracker.opentrackr.org:443/announce",
]

export const clientMagnet = (hash: string, title: string) =>
    ytsMagnet(hash, title) + CLIENT_TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join("")

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

/** Same folder name the torrent engine uses for <library>/Series/<name> */
export function seriesFolder(name: string) {
    return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").slice(0, 120).trim()
}

export function startSeriesTorrent(hash: string, title: string, series: string) {
    return postJson<{ hash: string }>(`${TORRENT_ENGINE}/torrents`, { magnet: clientMagnet(hash, title), mode: "download", title, folder: seriesFolder(series) })
}

/** A series release: one episode, or a pack of whole seasons (season..last, both missing for "complete" packs) */
export type Series_Torrent = { hash: string, title: string, size: number, seeds: number, season: number | null, last?: number | null, episode: number | null, pack: boolean }

/** Sites behind a human check that have series, they open in Firefox */
export const SERIES_FIREFOX_SITES = [{ id: "mapple", name: "Mapple" }, { id: "duafile", name: "Duafile" }]

/** Sites behind a human check to download from, they open in Firefox */
export const SERIES_DOWNLOAD_SITES = [
    { id: "cinema-of-the-world", name: "Cinema of the World" },
    { id: "the-movie-channel", name: "the movie channel" },
    ...SERIES_FIREFOX_SITES,
    { id: "1337x-movies", name: "1337x Movies" },
    { id: "animeout", name: "AnimeOut" },
    { id: "animepahe", name: "AnimePahe" },
    { id: "anihq", name: "AniHQ" },
    { id: "animesilo", name: "AnimeSilo" },
    { id: "project-acgnx", name: "Project AcgnX" },
]

/** Season and episode in a file name, null for what it does not say */
export function fileEpisode(name: string) {
    const m = /\bS(\d{1,2})[ ._-]?E(\d{1,4})\b/i.exec(name) ?? /\b(\d{1,2})x(\d{2,3})\b/.exec(name)
    if (m) return { season: Number(m[1]), episode: Number(m[2]) }
    const e = /\b(?:E|EP|Episode)[ ._-]?(\d{1,4})\b/i.exec(name)
    return e ? { season: null, episode: Number(e[1]) } : null
}

/** The best seeded single release of an episode, otherwise the best seeded pack that has its season */
export function pickEpisodeTorrent(list: Series_Torrent[], season: number, episode: number) {
    const best = (xs: Series_Torrent[]) => [...xs].sort((a, b) => b.seeds - a.seeds)[0]
    return best(list.filter(t => !t.pack && t.episode === episode && (t.season === season || (t.season === null && season <= 1))))
        ?? best(list.filter(t => t.pack && (t.season === null || (t.season <= season && season <= (t.last ?? t.season)))))
}

export function fetchSeriesTorrents(imdb: string | undefined, title: string, source: "1337x" | "open") {
    return getJson<Series_Torrent[]>(`${MEDIA_HELPER}/media/series-torrents?${new URLSearchParams({ imdb: imdb ?? "", title, source })}`,
        source === "1337x" ? { signal: AbortSignal.timeout(HUMAN_CHECK_WAIT) } : undefined)
}

export function useSeriesTorrents(imdb: string | undefined, title: string, enabled: boolean, source: "1337x" | "open" = "open") {
    return useQuery({
        queryKey: ["series-torrents", imdb, title, source],
        queryFn: () => fetchSeriesTorrents(imdb, title, source),
        enabled: enabled && !!title,
        retry: source === "1337x" ? 0 : 1,
        staleTime: 1000 * 60 * 10,
    })
}

export type Series_SiteLink = { host: string, url: string }
export type Series_SiteEpisode = { label: string, episode: number | null, group: string, options: { quality: string, links: Series_SiteLink[] }[] }

export function useSeriesSiteLinks(title: string, enabled: boolean) {
    return useQuery({
        queryKey: ["series-site-links", title],
        queryFn: () => getJson<{ page: string | null, title?: string, episodes: Series_SiteEpisode[] }>(
            `${MEDIA_HELPER}/media/series-links?${new URLSearchParams({ site: "dramaday", title })}`),
        enabled: enabled && !!title,
        retry: 1,
        staleTime: 1000 * 60 * 10,
    })
}

/** Episodes saved on disk for a series, from torrents and download sites */
export type Series_File = { name: string, file: string, size: number, complete: boolean, season: number | null, episode: number | null, url: string }

export function useSeriesFiles(series: string, refetchInterval: number | false = false) {
    const folder = seriesFolder(series)
    return useQuery({
        queryKey: ["series-files", folder],
        queryFn: () => getJson<Series_File[]>(`${TORRENT_ENGINE}/series-files?${new URLSearchParams({ folder })}`),
        enabled: !!folder,
        refetchInterval,
        retry: 1,
    })
}

/** Every series saved on disk, with the catalog entry of the same name when there is one */
export function useSeriesLibrary() {
    return useQuery({
        queryKey: ["series-library"],
        queryFn: async () => {
            const shows = await getJson<{ folder: string, files: Series_File[] }[]>(`${TORRENT_ENGINE}/series-library`)
            return Promise.all(shows.map(async show => {
                const found = await fetchCatalog({ type: "series", catalog: "top", search: show.folder }).catch(() => [] as Movie_Meta[])
                return { ...show, meta: found.find(m => seriesFolder(m.name).toLowerCase() === show.folder.toLowerCase()) }
            }))
        },
        refetchInterval: 20000,
        retry: 1,
    })
}

export function engineAction(action: "stop" | "resume" | "restore" | "library-remove", hash?: string, title?: string, mode?: "stream" | "download") {
    return postJson<unknown>(`${TORRENT_ENGINE}/torrents`, { action, hash, title, mode })
}

export function useMovieLibrary(refetchInterval: number | false = false) {
    const { seaFetch } = useSeaQuery()
    return useQuery({
        queryKey: ["movies-library"],
        queryFn: async () => {
            await syncClientDownloads(seaFetch).catch(() => {})
            return getJson<Movie_LibraryItem[]>(`${TORRENT_ENGINE}/library`)
        },
        refetchInterval,
        retry: 1,
    })
}

/** Where movie downloads are saved, chosen in Settings. Movies saved before in another folder can be moved there. */
export type Movie_EngineSettings = {
    libraryDir: string
    seriesDir: string
    defaultDir: string
    custom: boolean
    outside: number
    moving: { total: number, moved: number, done: boolean, error: string } | null
    external: string[]
    hidden: Movie_HiddenItem[]
}

export type Movie_HiddenItem = { id: string, name: string, poster: string, year: string, at: number }

export function useMovieSettings(refetchInterval: number | false = false) {
    return useQuery({
        queryKey: ["movies-settings"],
        queryFn: () => getJson<Movie_EngineSettings>(`${TORRENT_ENGINE}/settings`),
        refetchInterval,
        retry: 1,
    })
}

/** Movies hidden from the catalogs, kept by the torrent engine so they stay hidden after a restart. */
export function useHiddenMovies() {
    const { data } = useMovieSettings()
    return React.useMemo(() => new Set((data?.hidden ?? []).map(x => x.id)), [data?.hidden])
}

export function useSetMovieHidden() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: ({ meta, hidden }: { meta: Pick<Movie_Meta, "id" | "name" | "poster" | "year" | "releaseInfo" | "released">, hidden: boolean }) =>
            postJson<{ hidden: Movie_HiddenItem[] }>(`${TORRENT_ENGINE}/torrents`, hidden
                ? { action: "hide", item: { id: meta.id, name: meta.name, poster: moviePoster(meta.poster), year: movieYear(meta) } }
                : { action: "unhide", id: meta.id }),
        onSuccess: ({ hidden }) => qc.setQueryData<Movie_EngineSettings>(["movies-settings"], s => s && { ...s, hidden }),
    })
}

export const setMovieLibraryDir = (dir: string) =>
    postJson<{ libraryDir: string, outside: number }>(`${TORRENT_ENGINE}/torrents`, { action: "set-library-dir", dir })

export const moveMoviesToLibrary = () => postJson<unknown>(`${TORRENT_ENGINE}/torrents`, { action: "move-library" })

type SeaFetch = ReturnType<typeof useSeaQuery>["seaFetch"]

/**
 * Sends the movie to the torrent client set in Settings (qBittorrent or Transmission), saving it in the movie library folder.
 * The movie joins the Library once the client finishes it.
 */
export async function downloadWithTorrentClient(seaFetch: SeaFetch, magnet: string, hash: string, title: string, media: Movie_LibraryMedia) {
    const { dir } = await postJson<{ dir: string }>(`${TORRENT_ENGINE}/torrents`, { action: "external-add", hash, media, release: title })
    try {
        await seaFetch(API_ENDPOINTS.TORRENT_CLIENT.TorrentClientAction.endpoint, "POST", { action: "add-magnet", magnet, dir, noSeed: true })
    }
    catch (e: any) {
        await postJson(`${TORRENT_ENGINE}/torrents`, { action: "external-remove", hash }).catch(() => {})
        throw new Error(e?.response?.data?.error || e?.message || "The torrent client did not take the movie")
    }
}

/** Adds movies the torrent client has finished to the Library. */
export async function syncClientDownloads(seaFetch: SeaFetch) {
    const { external } = await getJson<Movie_EngineSettings>(`${TORRENT_ENGINE}/settings`)
    if (!external.length) return
    // Finished torrents are often stopped by the client, so the full list is used
    const torrents = await seaFetch<TorrentClient_Torrent[]>(API_ENDPOINTS.TORRENT_CLIENT.GetActiveTorrentList.endpoint + "?all=true", "GET")
    await postJson(`${TORRENT_ENGINE}/torrents`, { action: "external-sync", present: (torrents ?? []).map(t => t.hash.toLowerCase()) })
    for (const t of torrents ?? []) {
        const hash = t.hash.toLowerCase()
        if (external.includes(hash) && t.progress >= 1 && t.contentPath) {
            await postJson(`${TORRENT_ENGINE}/torrents`, { action: "external-done", hash, path: t.contentPath }).catch(() => {})
            // Torrent clients that ignored the no-seeding limit are stopped here
            if (t.status === "seeding") {
                await seaFetch(API_ENDPOINTS.TORRENT_CLIENT.TorrentClientAction.endpoint, "POST", { action: "pause", hash: t.hash }).catch(() => {})
            }
        }
    }
}

const normalizeTitle = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim()

/** Finds the movie a release name is for, e.g. "Interstellar.2014.1080p.BluRay" → Interstellar (2014). */
async function identifyRelease(release: string) {
    const m = /^(.*?)[\s.(\[_-]+((?:19|20)\d{2})\b/.exec(release)
    const title = (m?.[1] ?? release.replace(/\.[a-z0-9]{2,4}$/i, "")).replace(/[._]+/g, " ").trim()
    const year = m?.[2]
    if (!title) return undefined
    const metas = await fetchCatalog({ search: title })
    const want = normalizeTitle(title)
    const sameName = metas.filter(meta => normalizeTitle(meta.name) === want)
    return year ? sameName.find(meta => String(movieYear(meta)) === year) : sameName[0]
}

/**
 * Adds finished downloads the Library does not know yet (older ones, or files placed in the downloads folder by hand).
 * Returns how many were added and the releases that could not be matched to a movie.
 */
export async function scanLibraryDownloads() {
    const found = await getJson<{ hash: string, release: string, size: number }[]>(`${TORRENT_ENGINE}/library-scan`)
    let added = 0
    const unidentified: string[] = []
    for (const item of found) {
        const meta = await identifyRelease(item.release).catch(() => undefined)
        if (!meta) {
            unidentified.push(item.release)
            continue
        }
        await postJson(`${TORRENT_ENGINE}/torrents`, { action: "library-add", hash: item.hash, media: metaToLibraryMedia(meta) })
        added++
    }
    return { added, unidentified }
}

export async function playLibraryItem(item: Movie_LibraryItem) {
    const subtitles = await fetchMovieSubtitles(item.imdb, item.file.split("/").pop())
    return playMovieUrl(TORRENT_ENGINE + item.url, item.year ? `${item.title} (${item.year})` : item.title, subtitles)
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

export async function playMovieUrl(url: string, title: string, subtitles: Movie_Subtitle[] = []) {
    if (window.SeanimeMediaHub?.play) {
        return window.SeanimeMediaHub.play(url, title, subtitles)
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
            subtitleTracks: subtitles.map((sub, index) => ({ index, ...sub, default: sub.language === "ar", useLibassRenderer: true })),
            isNakamaWatchParty: false,
        },
    })
}

export async function playEngineFile(file: Movie_EngineFile, title: string, imdb?: string) {
    return playMovieUrl(TORRENT_ENGINE + file.url, title, await fetchMovieSubtitles(imdb, file.name))
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Subtitles
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export type Movie_Subtitle = Movie_CapturedStream["subtitles"][number]

type OpenSubtitle = { url: string, lang: string, movieReleaseName?: string, subtitleFileName?: string, fpsMilli?: number }

// OpenSubtitles uses ISO 639-2 codes, the player's language preferences use the two letter ones
const SUBTITLE_LANGUAGES: Record<string, string> = {
    ara: "ar", eng: "en", fre: "fr", ger: "de", spa: "es", spn: "es", ita: "it", por: "pt", pob: "pt", dut: "nl", rus: "ru",
    tur: "tr", per: "fa", gre: "el", ell: "el", cze: "cs", rum: "ro", ron: "ro", pol: "pl", swe: "sv", dan: "da", fin: "fi",
    nor: "no", hun: "hu", heb: "he", chi: "zh", zht: "zh", jpn: "ja", kor: "ko", ind: "id", may: "ms", vie: "vi",
    tha: "th", hin: "hi", urd: "ur", hrv: "hr", scc: "sr", bul: "bg", ukr: "uk", slo: "sk", slv: "sl", est: "et", lav: "lv",
    lit: "lt", alb: "sq", mac: "mk", bos: "bs", ben: "bn", kur: "ku", ice: "is", cat: "ca", baq: "eu", glg: "gl",
}

const subtitleLists = new Map<string, Promise<OpenSubtitle[]>>()

function languageName(code: string, lang: string) {
    try {
        return new Intl.DisplayNames(["en"], { type: "language" }).of(lang === "pob" ? "pt-BR" : code) ?? code
    }
    catch {
        return code
    }
}

/**
 * Subtitles for a movie, the best match per language for the release being played (Arabic and English get a spare).
 * Never throws, playback goes on without subtitles when OpenSubtitles is unreachable.
 */
export async function fetchMovieSubtitles(imdb?: string, release = ""): Promise<Movie_Subtitle[]> {
    if (!imdb?.startsWith("tt")) return []
    let request = subtitleLists.get(imdb)
    if (!request) {
        request = (async () => {
            const res = await fetch(`${OPENSUBTITLES}/subtitles/${imdb.includes(":") ? "series" : "movie"}/${imdb}.json`, { signal: AbortSignal.timeout(8000) })
            if (!res.ok) throw new Error(`OpenSubtitles ${res.status}`)
            const data = await res.json() as { subtitles?: OpenSubtitle[] }
            return Array.isArray(data?.subtitles) ? data.subtitles : []
        })()
        request.catch(() => subtitleLists.delete(imdb))
        subtitleLists.set(imdb, request)
    }
    const list = await request.catch(() => [] as OpenSubtitle[])

    const quality = /\b(480|720|1080|2160)p\b/i.exec(release)?.[0].toLowerCase()
    // Subtitles are timed to one rip, prefer the YIFY/BluRay ones the YTS torrents are, never a cinema recording
    const score = (s: OpenSubtitle) => {
        const name = `${s.movieReleaseName ?? ""} ${s.subtitleFileName ?? ""}`.toLowerCase()
        let n = 0
        if (/\b(cam|hdcam|ts|hdts|telesync|tc|telecine|hc)\b/.test(name)) n -= 20
        if (/yify|yts/.test(name)) n += 10
        if (/blu-?ray|brrip|bdrip/.test(name)) n += 5
        if (quality && name.includes(quality)) n += 3
        if (s.fpsMilli === 23976) n += 2
        return n
    }

    const byLanguage = new Map<string, OpenSubtitle[]>()
    for (const s of list) {
        if (typeof s?.url !== "string" || !s.url.startsWith("https://")) continue
        const code = SUBTITLE_LANGUAGES[s.lang] ?? s.lang
        byLanguage.set(code, [...(byLanguage.get(code) ?? []), s])
    }
    const order = (code: string) => code === "ar" ? 0 : code === "en" ? 1 : 2
    return [...byLanguage.entries()]
        .map(([code, subs]) => ({ code, name: languageName(code, subs[0].lang), subs: subs.sort((a, b) => score(b) - score(a)) }))
        .sort((a, b) => order(a.code) - order(b.code) || a.name.localeCompare(b.name))
        .flatMap(({ code, name, subs }) => subs.slice(0, order(code) < 2 ? 2 : 1).map((s, i) => ({
            src: s.url,
            type: "srt",
            label: i ? `${name} ${i + 1}` : name,
            language: code,
        })))
}
