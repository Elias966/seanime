import { SiteBrowser } from "@/app/(main)/entry/_containers/online-download/online-download-drawer"
import { sendDownloadAction } from "@/app/(main)/online-downloads/_lib/online-downloads"
import { MovieDownloads } from "@/app/(main)/movies/_containers/movie-downloads"
import {
    clientMagnet,
    engineAction,
    fetchEngineTorrents,
    fileEpisode,
    formatBytes,
    largestPlayableFile,
    Movie_EngineFile,
    Movie_EngineTorrent,
    playEngineFile,
    Series_SiteEpisode,
    Series_Torrent,
    seriesFolder,
    SERIES_DOWNLOAD_SITES,
    startEngineTorrent,
    startSeriesTorrent,
    useEngineTorrents,
    useMovieSettings,
    useSeriesSiteLinks,
    useSeriesTorrents,
    useTorrentSource,
} from "@/app/(main)/movies/_lib/movies.api"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Modal } from "@/components/ui/modal"
import { ProgressBar } from "@/components/ui/progress-bar"
import { StaticTabs } from "@/components/ui/tabs"
import { Vaul, VaulContent } from "@/components/vaul"
import React from "react"
import { BiDownload, BiLinkExternal, BiPlay, BiSkipNext } from "react-icons/bi"
import { toast } from "sonner"

const DRAMADAY = { id: "dramaday", origin: "https://dramaday.me", browseUrl: (t: string) => `https://dramaday.me/?s=${encodeURIComponent(t)}` }

/** A series torrent being streamed. Without an episode (a pack from the Torrents tab) the person picks the file. */
export type Series_TorrentStream = { hash: string, title: string, series: string, imdb?: string, season?: number, episode?: number, pack: boolean }

export async function startSeriesStream(t: Series_Torrent, title: string, series: string, imdb?: string, season?: number, episode?: number): Promise<Series_TorrentStream> {
    const { hash } = await startEngineTorrent(clientMagnet(t.hash, title), title, "stream")
    return { hash: hash || t.hash, title, series, imdb, season, episode, pack: t.pack }
}

/** Waits for the torrent's details, then hands the episode's file to the player. */
export function SeriesStreamModal({ streaming, onClose }: { streaming?: Series_TorrentStream, onClose: () => void }) {
    const [torrent, setTorrent] = React.useState<Movie_EngineTorrent>()
    const [error, setError] = React.useState<string>()
    const [files, setFiles] = React.useState<Movie_EngineFile[]>()

    const close = (played: boolean) => {
        if (!played && streaming) engineAction("stop", streaming.hash).catch(() => {})
        onClose()
    }
    const play = async (file: Movie_EngineFile) => {
        const found = fileEpisode(file.name)
        const season = streaming?.season ?? found?.season ?? undefined
        const episode = streaming?.episode ?? found?.episode
        const imdb = streaming?.imdb && season !== undefined && episode !== undefined ? `${streaming.imdb}:${season}:${episode}` : undefined
        const title = episode !== undefined && season !== undefined
            ? `${streaming!.series} - S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` : streaming!.title
        await playEngineFile(file, title, imdb)
        close(true)
    }

    React.useEffect(() => {
        setTorrent(undefined)
        setError(undefined)
        setFiles(undefined)
        if (!streaming) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout>
        let missing = 0
        const poll = async () => {
            try {
                const t = (await fetchEngineTorrents()).find(x => x.hash.toLowerCase() === streaming.hash.toLowerCase())
                if (cancelled) return
                setTorrent(t)
                if (!t && ++missing > 10) return setError("The torrent was stopped")
                if (t?.error) return setError(t.error)
                if (t?.ready) {
                    const playable = t.files.filter(f => f.playable).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                    if (!playable.length) return setError("No supported video files in this torrent")
                    if (!streaming.pack) return await play(largestPlayableFile(t))
                    if (streaming.episode === undefined) return setFiles(playable)
                    const file = playable.find(f => {
                        const e = fileEpisode(f.name)
                        return e?.episode === streaming.episode && (e?.season === null || e?.season === streaming.season)
                    })
                    if (file) return await play(file)
                    // The names do not say which episode is which
                    return setFiles(playable)
                }
            }
            catch (e: any) {
                if (!cancelled) setError(e?.message ?? String(e))
                return
            }
            timer = setTimeout(poll, 1500)
        }
        poll()
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [streaming?.hash, streaming?.episode])

    return (
        <Modal open={!!streaming} onOpenChange={v => !v && close(false)} title={files ? "Choose an episode" : "Preparing stream"} contentClass="max-w-xl">
            <div className="space-y-4" data-series-stream-modal>
                <p className="font-medium line-clamp-2">{streaming?.title}</p>
                {error ? <p className="text-red-300">{error}</p> : files ? <div className="max-h-[50vh] overflow-y-auto space-y-1 pr-1">
                    {files.map(f => <button
                        key={f.url}
                        className="w-full text-left text-sm rounded-md border px-3 py-2 hover:border-[--brand] truncate"
                        onClick={() => play(f).catch((e: any) => setError(e?.message ?? String(e)))}
                        data-series-stream-file
                    >{f.name}</button>)}
                </div> : <>
                    <ProgressBar isIndeterminate={!torrent?.progress} value={Math.round((torrent?.progress ?? 0) * 100)} size="sm" />
                    <p className="text-sm text-[--muted]">
                        {!torrent ? "Starting torrent…" : `Finding peers and buffering… ${torrent.peers} peers · ${formatBytes(torrent.downloadSpeed)}/s`}
                    </p>
                </>}
            </div>
        </Modal>
    )
}

/** A pack covers the season when its range includes it ("complete" packs cover every season) */
const covers = (t: Series_Torrent, season: number) => t.pack && (t.season === null || (t.season <= season && season <= (t.last ?? t.season)))

/**
 * Downloads for a whole series into <library>/Series/<name>: torrents through the app's engine (a season pack when
 * there is one, otherwise the episodes picked), and for dramas Dramaday's links, opened in the app so the user passes
 * the site's link pages; the file it gives is saved into the same folder.
 */
export function SeriesDownloadDrawer({ open, onOpenChange, title, imdb, isDrama, season, seasons, onStream }: {
    open: boolean
    onOpenChange: (v: boolean) => void
    title: string
    imdb?: string
    isDrama: boolean
    season: number
    seasons: number[]
    onStream: (stream: Series_TorrentStream) => void
}) {
    const [tab, setTab] = React.useState<"torrents" | "sites" | "firefox" | "progress">("torrents")
    const settings = useMovieSettings().data
    const folder = seriesFolder(title)
    const dir = settings?.seriesDir ? `${settings.seriesDir}/${folder}` : ""

    return (
        <Vaul open={open} onOpenChange={onOpenChange}>
            <VaulContent className="bg-gray-950 h-[92%] mx-4 xl:mx-[6rem] overflow-hidden" data-series-download-drawer>
                <div className="p-4 lg:p-6 flex flex-col gap-3 h-full">
                    <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-xl font-semibold">Download</h3>
                        <span className="text-[--muted] text-sm truncate max-w-[40ch]">{title}</span>
                        {!!dir && <span className="text-xs text-[--muted] ml-auto truncate max-w-[60ch]">Saving to {dir}</span>}
                    </div>
                    <StaticTabs
                        className="h-10 border-b"
                        items={[
                            { name: "Torrents", isCurrent: tab === "torrents", onClick: () => setTab("torrents") },
                            ...(isDrama ? [{ name: "Dramaday", isCurrent: tab === "sites", onClick: () => setTab("sites") }] : []),
                            { name: "Websites", isCurrent: tab === "firefox", onClick: () => setTab("firefox") },
                            { name: "Downloading", isCurrent: tab === "progress", onClick: () => setTab("progress") },
                        ]}
                    />
                    <div className="flex-1 min-h-0 flex flex-col gap-3">
                        {tab === "torrents" && <SeriesTorrents title={title} imdb={imdb} season={season} seasons={seasons} onStream={s => {
                            onOpenChange(false)
                            onStream(s)
                        }} onStarted={() => setTab("progress")} />}
                        {tab === "sites" && <SeriesSiteLinks title={title} dir={dir} />}
                        {tab === "firefox" && <SeriesFirefoxSites title={title} />}
                        {tab === "progress" && <div className="flex-1 overflow-y-auto pr-1">
                            <MovieDownloads filter={t => t.folder === folder} empty="No episodes of this series are downloading." />
                        </div>}
                    </div>
                </div>
            </VaulContent>
        </Vaul>
    )
}

function SeriesTorrents({ title, imdb, season: initialSeason, seasons, onStarted, onStream }: {
    title: string, imdb?: string, season: number, seasons: number[], onStarted: () => void, onStream: (stream: Series_TorrentStream) => void
}) {
    const [source, setSource] = useTorrentSource<"1337x" | "open">("series", "1337x")
    const { data, isLoading, isError, error } = useSeriesTorrents(imdb, title, true, source)
    const running = useEngineTorrents(3000).data
    const [season, setSeason] = React.useState(initialSeason)
    const [selected, setSelected] = React.useState<Set<string>>(new Set())
    const [busy, setBusy] = React.useState(false)
    React.useEffect(() => setSelected(new Set()), [season])

    const all = data ?? []
    const packs = all.filter(t => covers(t, season)).sort((a, b) => b.seeds - a.seeds)
    // One release per episode, the best seeded one
    const episodes = Object.values(all.filter(t => !t.pack && (t.season === season || (t.season === null && season <= 1)))
        .reduce<Record<number, Series_Torrent>>((m, t) => {
            if (t.episode !== null && (!m[t.episode] || m[t.episode].seeds < t.seeds)) m[t.episode] = t
            return m
        }, {}))
        .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
    const active = new Set((running ?? []).map(t => t.hash))

    const start = async (list: Series_Torrent[]) => {
        setBusy(true)
        let ok = 0
        for (const t of list) {
            try {
                await startSeriesTorrent(t.hash, t.title, title)
                ok++
            }
            catch (e: any) {
                toast.error(`${t.title}: ${e?.message ?? e}`)
            }
        }
        setBusy(false)
        setSelected(new Set())
        if (ok) {
            toast.success(`${ok} download${ok > 1 ? "s" : ""} started. Up to 10 run at once, the rest wait their turn.`)
            onStarted()
        }
    }

    const stream = (t: Series_Torrent) => startSeriesStream(t, t.title, title, imdb, t.pack ? season : (t.season ?? season), t.episode ?? undefined)
        .then(onStream).catch((e: any) => toast.error(e?.message ?? String(e)))
    const streamButton = (t: Series_Torrent) => <Button size="sm" intent="white" leftIcon={<BiPlay />} disabled={active.has(t.hash)}
        onClick={() => stream(t)} data-series-torrent-stream>Stream</Button>

    const free = episodes.filter(t => !active.has(t.hash))
    const allPicked = free.length > 0 && free.every(t => selected.has(t.hash))
    const count = free.filter(t => selected.has(t.hash)).length

    return (
        <div className="flex-1 min-h-0 flex flex-col gap-3" data-series-torrents>
            <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm text-[--muted] flex-1">
                    A season pack gets every episode at once; otherwise pick the episodes.
                </p>
                <select
                    className="rounded-md bg-gray-900 border px-2 text-sm h-8"
                    value={source}
                    onChange={e => setSource(e.target.value as "1337x" | "open")}
                    aria-label="Torrent source"
                    data-series-torrent-source
                >
                    <option value="1337x">1337x</option>
                    <option value="open">EZTV and Torrents-CSV</option>
                </select>
                {seasons.length > 1 && <select
                    className="rounded-md bg-gray-900 border px-2 text-sm h-8"
                    value={season}
                    onChange={e => setSeason(Number(e.target.value))}
                    data-series-torrent-season
                >
                    {seasons.filter(s => s > 0).map(s => <option key={s} value={s}>Season {s}</option>)}
                </select>}
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {isLoading && <div className="flex items-center gap-3 text-[--muted] py-6"><LoadingSpinner className="w-6 h-6 m-0" /> Looking for torrents…</div>}
                {isError && <p className="text-sm text-red-400">{(error as Error)?.message ?? "The torrent sites did not answer, try another source."}</p>}
                {!isLoading && !isError && !packs.length && !episodes.length && <p className="text-sm text-[--muted] py-4">
                    No torrents were found for season {season}. Try the download sites, or another season.
                </p>}

                {!!packs.length && <div className="space-y-2" data-series-packs>
                    <h4 className="font-semibold">Season packs</h4>
                    {packs.slice(0, 8).map(t => <TorrentRow key={t.hash} t={t} label={packLabel(t)} active={active.has(t.hash)}
                        action={<>{streamButton(t)}<Button size="sm" intent="primary" leftIcon={<BiDownload />} disabled={busy || active.has(t.hash)}
                            onClick={() => start([t])} data-series-pack-download>Download</Button></>} />)}
                </div>}

                {!!episodes.length && <div className="space-y-2" data-series-episode-torrents>
                    <div className="flex items-center gap-3 text-sm">
                        <h4 className="font-semibold text-base flex-1">Episodes</h4>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox" className="w-4 h-4 accent-[--brand]" checked={allPicked} disabled={!free.length}
                                onChange={() => setSelected(allPicked ? new Set() : new Set(free.map(t => t.hash)))}
                                data-series-select-all
                            />
                            Select all{free.length ? ` (${free.length})` : ""}
                        </label>
                        <Button size="sm" intent="primary" leftIcon={<BiDownload />} disabled={!count || busy} loading={busy}
                            onClick={() => start(free.filter(t => selected.has(t.hash)))} data-series-download-selected>
                            Download selected{count ? ` (${count})` : ""}
                        </Button>
                    </div>
                    {episodes.map(t => <TorrentRow key={t.hash} t={t} label={`Episode ${t.episode}`} active={active.has(t.hash)}
                        action={<>{streamButton(t)}<input type="checkbox" className="w-4 h-4 accent-[--brand]" disabled={active.has(t.hash)}
                            checked={selected.has(t.hash)}
                            onChange={() => setSelected(s => {
                                const n = new Set(s)
                                if (n.has(t.hash)) n.delete(t.hash)
                                else n.add(t.hash)
                                return n
                            })} /></>} />)}
                </div>}
            </div>
        </div>
    )
}

/** Sites behind a human check, the person does the check and finds the series in Firefox */
function SeriesFirefoxSites({ title }: { title: string }) {
    const open = (site: { id: string, name: string }) => window.SeanimeMediaHub?.browse?.(site.id)
        .then(() => toast.success(`${site.name} opened in Firefox`))
        .catch((e: any) => toast.error(e?.message ?? String(e)))
    return (
        <div className="flex-1 overflow-y-auto pr-1 space-y-2" data-series-firefox-sites>
            <p className="text-sm text-[--muted]">
                These sites ask for a human check, so they open in Firefox. Search for {title} there. Their downloads are saved by Firefox and do not show under Downloading.
            </p>
            {SERIES_DOWNLOAD_SITES.map(site => <div key={site.id} className="flex items-center gap-3 rounded-md border p-3">
                <span className="font-medium flex-1">{site.name}</span>
                <Button size="sm" intent="white" leftIcon={<BiLinkExternal />} onClick={() => open(site)} data-series-firefox-site={site.id}>Open in Firefox</Button>
            </div>)}
        </div>
    )
}

function packLabel(t: Series_Torrent) {
    if (t.season === null) return "Complete series"
    return t.last && t.last !== t.season ? `Seasons ${t.season}–${t.last}` : `Season ${t.season}`
}

function TorrentRow({ t, label, action, active }: { t: Series_Torrent, label: string, action: React.ReactNode, active: boolean }) {
    return (
        <div className="border rounded-[--radius-md] bg-[--paper] px-3 py-2 flex items-center gap-3" data-series-torrent={t.hash}>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{label}{active && <span className="text-[--muted] font-normal"> · downloading</span>}</p>
                <p className="text-xs text-[--muted] line-clamp-1">{t.title}</p>
            </div>
            <span className="text-xs text-[--muted] flex-none">{t.size ? formatBytes(t.size) : ""} · {t.seeds} seeds</span>
            {action}
        </div>
    )
}

/** Dramaday's links per episode and quality. Each opens in the app; its link pages are passed by the user. */
function SeriesSiteLinks({ title, dir }: { title: string, dir: string }) {
    const { data, isLoading, isError } = useSeriesSiteLinks(title, true)
    const episodes = data?.episodes ?? []
    const groups = [...new Set(episodes.map(e => e.group))]
    const [group, setGroup] = React.useState<string>()
    const currentGroup = group ?? groups[0] ?? ""
    const inGroup = episodes.filter(e => e.group === currentGroup)
    const qualities = [...new Set(inGroup.flatMap(e => e.options.map(o => o.quality)))]
    const [quality, setQuality] = React.useState<string>()
    const currentQuality = quality && qualities.includes(quality) ? quality : qualities[0] ?? ""
    const hosts = [...new Set(inGroup.flatMap(e => e.options.filter(o => o.quality === currentQuality).flatMap(o => o.links.map(l => l.host))))]
    const [host, setHost] = React.useState<string>()
    const currentHost = host && hosts.includes(host) ? host : hosts[0] ?? ""
    const [picked, setPicked] = React.useState<Set<string>>(new Set())
    React.useEffect(() => setPicked(new Set()), [currentGroup])
    // Links opened one after another: "Next episode" moves on once the current file is downloading
    const [queue, setQueue] = React.useState<{ label: string, url: string }[]>([])
    const [at, setAt] = React.useState(0)

    const desktop = typeof window !== "undefined" && !!window.electron?.on && !!window.electron?.localServer?.allowWebviewOrigin
    React.useEffect(() => {
        if (desktop && dir) sendDownloadAction("dir", { sourceId: DRAMADAY.id, dir, title, mediaId: 0 })
    }, [desktop, dir])

    const linkFor = (e: Series_SiteEpisode) => e.options.find(o => o.quality === currentQuality)?.links.find(l => l.host === currentHost)
    const withLink = inGroup.filter(e => !!linkFor(e))
    const allPicked = withLink.length > 0 && withLink.every(e => picked.has(e.label))
    const open = (list: Series_SiteEpisode[]) => {
        const q = list.map(e => ({ label: e.label, url: linkFor(e)!.url })).filter(x => x.url)
        if (!q.length) return
        setQueue(q)
        setAt(0)
    }

    if (!desktop) return <p className="text-[--muted]">Download sites need the Seanime desktop app.</p>
    if (queue.length) {
        const item = queue[Math.min(at, queue.length - 1)]
        return <SiteBrowser
            key={item.url}
            site={{ ...DRAMADAY, adsAllowed: false }}
            title={title}
            url={item.url}
            backLabel="Back to the episodes"
            onClose={() => setQueue([])}
        >
            <span className="text-sm text-[--muted] ml-2" data-series-site-current>
                Episode {item.label} · {at + 1} of {queue.length}. Pass the link page; the file is saved into the series folder.
            </span>
            {at + 1 < queue.length && <Button size="sm" intent="primary-subtle" leftIcon={<BiSkipNext />} onClick={() => setAt(a => a + 1)}
                data-series-site-next>Next episode</Button>}
        </SiteBrowser>
    }

    return (
        <div className="flex-1 min-h-0 flex flex-col gap-3" data-series-site-links>
            <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm text-[--muted] flex-1">
                    Dramaday links open here. Their link pages (ouo, cuty, Google Drive) are passed by you; the file is saved into the series folder.
                </p>
                {!!data?.page && <Button size="sm" intent="gray-subtle" leftIcon={<BiLinkExternal />}
                    onClick={() => setQueue([{ label: "page", url: data.page! }])}>Open the Dramaday page</Button>}
            </div>
            {isLoading && <div className="flex items-center gap-3 text-[--muted] py-6"><LoadingSpinner className="w-6 h-6 m-0" /> Looking on Dramaday…</div>}
            {isError && <p className="text-sm text-red-400">Dramaday did not answer, try again later.</p>}
            {!isLoading && !isError && !episodes.length && <p className="text-sm text-[--muted] py-4">Dramaday has no downloads for this title.</p>}
            {!!episodes.length && <>
                <div className="flex items-center gap-2 flex-wrap text-sm">
                    {groups.length > 1 && <select className="rounded-md bg-gray-900 border px-2 h-8" value={currentGroup}
                        onChange={e => setGroup(e.target.value)} data-series-site-group>
                        {groups.map(g => <option key={g} value={g}>{g || "Release"}</option>)}
                    </select>}
                    <select className="rounded-md bg-gray-900 border px-2 h-8" value={currentQuality} onChange={e => setQuality(e.target.value)}
                        data-series-site-quality>
                        {qualities.map(q => <option key={q} value={q}>{q}</option>)}
                    </select>
                    <select className="rounded-md bg-gray-900 border px-2 h-8" value={currentHost} onChange={e => setHost(e.target.value)}
                        data-series-site-host>
                        {hosts.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <div className="flex-1" />
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" className="w-4 h-4 accent-[--brand]" checked={allPicked} disabled={!withLink.length}
                            onChange={() => setPicked(allPicked ? new Set() : new Set(withLink.map(e => e.label)))} data-series-site-select-all />
                        Select all ({withLink.length})
                    </label>
                    <Button size="sm" intent="primary" leftIcon={<BiDownload />} disabled={!withLink.some(e => picked.has(e.label))}
                        onClick={() => open(withLink.filter(e => picked.has(e.label)))} data-series-site-open-selected>
                        Open selected
                    </Button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {inGroup.map(e => {
                        const link = linkFor(e)
                        return <div key={e.group + e.label} className="border rounded-[--radius-md] bg-[--paper] px-3 py-2 flex items-center gap-3"
                            data-series-site-episode={e.label}>
                            <input type="checkbox" className="w-4 h-4 accent-[--brand]" disabled={!link} checked={picked.has(e.label)}
                                onChange={() => setPicked(s => {
                                    const n = new Set(s)
                                    if (n.has(e.label)) n.delete(e.label)
                                    else n.add(e.label)
                                    return n
                                })} />
                            <p className="flex-1 text-sm font-medium">{/^\d+$/.test(e.label) ? `Episode ${Number(e.label)}` : e.label}</p>
                            <span className="text-xs text-[--muted]">{e.options.map(o => o.quality).join(" · ")}</span>
                            <Button size="sm" intent="gray-subtle" disabled={!link} onClick={() => open([e])}>
                                {link ? `Open ${currentHost}` : `No ${currentHost}`}
                            </Button>
                        </div>
                    })}
                </div>
            </>}
        </div>
    )
}
