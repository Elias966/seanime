import { SiteBrowser } from "@/app/(main)/entry/_containers/online-download/online-download-drawer"
import { sendDownloadAction } from "@/app/(main)/online-downloads/_lib/online-downloads"
import { MovieDownloads } from "@/app/(main)/movies/_containers/movie-downloads"
import {
    formatBytes,
    Series_SiteEpisode,
    Series_Torrent,
    seriesFolder,
    startSeriesTorrent,
    useEngineTorrents,
    useMovieSettings,
    useSeriesSiteLinks,
    useSeriesTorrents,
} from "@/app/(main)/movies/_lib/movies.api"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { StaticTabs } from "@/components/ui/tabs"
import { Vaul, VaulContent } from "@/components/vaul"
import React from "react"
import { BiDownload, BiLinkExternal, BiSkipNext } from "react-icons/bi"
import { toast } from "sonner"

const DRAMADAY = { id: "dramaday", origin: "https://dramaday.me", browseUrl: (t: string) => `https://dramaday.me/?s=${encodeURIComponent(t)}` }

/** A pack covers the season when its range includes it ("complete" packs cover every season) */
const covers = (t: Series_Torrent, season: number) => t.pack && (t.season === null || (t.season <= season && season <= (t.last ?? t.season)))

/**
 * Downloads for a whole series into <library>/Series/<name>: torrents through the app's engine (a season pack when
 * there is one, otherwise the episodes picked), and for dramas Dramaday's links, opened in the app so the user passes
 * the site's link pages; the file it gives is saved into the same folder.
 */
export function SeriesDownloadDrawer({ open, onOpenChange, title, imdb, isDrama, season, seasons }: {
    open: boolean
    onOpenChange: (v: boolean) => void
    title: string
    imdb?: string
    isDrama: boolean
    season: number
    seasons: number[]
}) {
    const [tab, setTab] = React.useState<"torrents" | "sites" | "progress">("torrents")
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
                            { name: "Downloading", isCurrent: tab === "progress", onClick: () => setTab("progress") },
                        ]}
                    />
                    <div className="flex-1 min-h-0 flex flex-col gap-3">
                        {tab === "torrents" && <SeriesTorrents title={title} imdb={imdb} season={season} seasons={seasons} onStarted={() => setTab("progress")} />}
                        {tab === "sites" && <SeriesSiteLinks title={title} dir={dir} />}
                        {tab === "progress" && <div className="flex-1 overflow-y-auto pr-1">
                            <MovieDownloads filter={t => t.folder === folder} empty="No episodes of this series are downloading." />
                        </div>}
                    </div>
                </div>
            </VaulContent>
        </Vaul>
    )
}

function SeriesTorrents({ title, imdb, season: initialSeason, seasons, onStarted }: {
    title: string, imdb?: string, season: number, seasons: number[], onStarted: () => void
}) {
    const { data, isLoading, isError } = useSeriesTorrents(imdb, title, true)
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

    const free = episodes.filter(t => !active.has(t.hash))
    const allPicked = free.length > 0 && free.every(t => selected.has(t.hash))
    const count = free.filter(t => selected.has(t.hash)).length

    return (
        <div className="flex-1 min-h-0 flex flex-col gap-3" data-series-torrents>
            <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm text-[--muted] flex-1">
                    Torrents found on EZTV and Torrents-CSV. A season pack gets every episode at once; otherwise pick the episodes.
                </p>
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
                {isError && <p className="text-sm text-red-400">The torrent sites did not answer, try again later.</p>}
                {!isLoading && !isError && !packs.length && !episodes.length && <p className="text-sm text-[--muted] py-4">
                    No torrents were found for season {season}. Try the download sites, or another season.
                </p>}

                {!!packs.length && <div className="space-y-2" data-series-packs>
                    <h4 className="font-semibold">Season packs</h4>
                    {packs.slice(0, 8).map(t => <TorrentRow key={t.hash} t={t} label={packLabel(t)} active={active.has(t.hash)}
                        action={<Button size="sm" intent="primary" leftIcon={<BiDownload />} disabled={busy || active.has(t.hash)}
                            onClick={() => start([t])} data-series-pack-download>Download</Button>} />)}
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
                        action={<input type="checkbox" className="w-4 h-4 accent-[--brand]" disabled={active.has(t.hash)}
                            checked={selected.has(t.hash)}
                            onChange={() => setSelected(s => {
                                const n = new Set(s)
                                if (n.has(t.hash)) n.delete(t.hash)
                                else n.add(t.hash)
                                return n
                            })} />} />)}
                </div>}
            </div>
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
