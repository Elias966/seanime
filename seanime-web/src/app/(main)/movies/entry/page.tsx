import { TrailerModal } from "@/app/(main)/_features/anime/_components/trailer-modal"
import { MediaEntryAudienceScore, MediaEntryGenresList } from "@/app/(main)/_features/media/_components/media-entry-metadata-components"
import { MediaEntryPageLoadingDisplay } from "@/app/(main)/_features/media/_components/media-entry-page-loading-display"
import { MediaPageHeader, MediaPageHeaderDetailsContainer } from "@/app/(main)/_features/media/_components/media-page-header-components"
import { ENTRY_VIEW_SHELL_TRANSITION, ENTRY_VIEW_TRANSITION } from "@/app/(main)/entry/_containers/entry-view-transition"
import { imdbToScore, MovieListButton } from "@/app/(main)/movies/_components/movie-entry-card"
import { MovieCarousel } from "@/app/(main)/movies/_containers/movie-carousel"
import { MovieDownloads } from "@/app/(main)/movies/_containers/movie-downloads"
import { OnlineStreamModal, readLastSource } from "@/app/(main)/movies/_containers/online-stream-modal"
import {
    downloadWithTorrentClient,
    engineAction,
    fetchEngineTorrents,
    formatBytes,
    largestPlayableFile,
    Movie_EngineTorrent,
    Movie_Meta,
    Movie_YtsTorrent,
    metaToLibraryMedia,
    movieBackground,
    MOVIE_STREAM_SOURCES,
    moviePoster,
    Movie_StreamRef,
    Movie_StreamSource,
    movieTrailerId,
    movieYear,
    playEngineFile,
    playLibraryItem,
    startEngineTorrent,
    useEngineTorrents,
    useMovieHydraMatches,
    useMovieLibrary,
    useMovieMeta,
    useMovieSettings,
    useMovieTorrents,
    ytsMagnet,
} from "@/app/(main)/movies/_lib/movies.api"
import { imageShimmer } from "@/components/shared/image-helpers"
import { LuffyError } from "@/components/shared/luffy-error"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { SeaImage } from "@/components/shared/sea-image"
import { TextGenerateEffect } from "@/components/shared/text-generate-effect"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Modal } from "@/components/ui/modal"
import { Popover } from "@/components/ui/popover"
import { ProgressBar } from "@/components/ui/progress-bar"
import { StaticTabs } from "@/components/ui/tabs"
import { useSearchParams } from "@/lib/navigation"
import { TORRENT_CLIENT } from "@/lib/server/settings"
import { useSeaQuery } from "@/api/client/requests"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { AnimatePresence, motion } from "motion/react"
import React from "react"
import { BiPlay } from "react-icons/bi"
import { FiGlobe } from "react-icons/fi"
import { LuCalendar, LuClock, LuDownload, LuUsers } from "react-icons/lu"
import { PiMonitorPlayDuotone } from "react-icons/pi"
import { toast } from "sonner"

type MovieView = "torrentstream" | "onlinestream"

export default function Page() {
    const searchParams = useSearchParams()
    const id = searchParams.get("id") || undefined
    const { data: meta, isLoading, isError } = useMovieMeta(id)
    const [view, setView] = React.useState<MovieView>("torrentstream")

    React.useEffect(() => {
        setView("torrentstream")
    }, [id])

    React.useLayoutEffect(() => {
        if (meta?.name) document.title = `${meta.name} | Seanime`
    }, [meta?.name])

    if (isLoading) return <MediaEntryPageLoadingDisplay />
    if (isError || !meta) return <LuffyError title="Movie not found">
        <p>This movie could not be loaded, check your connection.</p>
    </LuffyError>

    const genre = (meta.genres ?? meta.genre ?? [])[0]

    return (
        <div data-movie-entry-page data-movie-id={meta.id} key={meta.id}>
            <div data-entry-back-navigation>
                <button type="button" data-entry-back-button aria-label="Go back" title="Go back" onClick={() => window.SeanimeNavigation?.back()}>
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="m12 19-7-7 7-7M5 12h14" />
                    </svg>
                </button>
            </div>

            <MovieMetaSection meta={meta} view={view} setView={setView} />

            <div className="px-4 md:px-8 relative z-[8]" data-movie-entry-page-content-container>
                <PageWrapper className="relative 2xl:order-first pb-10 lg:min-h-[calc(100vh-10rem)]" {...ENTRY_VIEW_SHELL_TRANSITION}>
                    <AnimatePresence mode="wait" initial={false}>
                        {view === "torrentstream" && <PageWrapper key="torrentstream" className="relative pb-10 pt-4 space-y-8" {...ENTRY_VIEW_TRANSITION}>
                            <MovieTorrentSection meta={meta} />
                        </PageWrapper>}
                        {view === "onlinestream" && <PageWrapper key="onlinestream" className="relative pb-10 pt-4 space-y-8" {...ENTRY_VIEW_TRANSITION}>
                            <MovieOnlineSection meta={meta} />
                        </PageWrapper>}
                    </AnimatePresence>

                    {!!genre && <div className="space-y-2 pt-6" data-movie-entry-more-like-this>
                        <h2>More like this</h2>
                        <MovieCarousel catalog={{ catalog: "top", genre }} excludeId={meta.id} lazy />
                    </div>}
                </PageWrapper>
            </div>
        </div>
    )
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function MovieMetaSection({ meta, view, setView }: { meta: Movie_Meta, view: MovieView, setView: (v: MovieView) => void }) {
    const year = movieYear(meta)
    const trailerId = movieTrailerId(meta)
    const genres = meta.genres ?? meta.genre ?? []
    const directors = [meta.director ?? []].flat()
    const released = meta.released ? new Date(meta.released) : undefined
    const { data: library } = useMovieLibrary()
    const downloaded = library?.find(x => x.imdb === meta.id)

    return (
        <MediaPageHeader backgroundImage={movieBackground(meta)} coverImage={moviePoster(meta.poster, "large")}>
            <MediaPageHeaderDetailsContainer>
                <div className="flex flex-col lg:flex-row gap-8" data-media-page-header-entry-details>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15 }}
                        className="flex-none aspect-[6/8] max-w-[150px] mx-auto lg:m-0 h-auto sm:max-w-[200px] lg:max-w-[230px] w-full relative rounded-[--radius-md] overflow-hidden bg-[--background] shadow-md block"
                    >
                        <SeaImage
                            src={moviePoster(meta.poster, "large")}
                            alt="cover image"
                            fill
                            priority
                            placeholder={imageShimmer(700, 475)}
                            className="object-cover object-center"
                        />
                    </motion.div>

                    <div className="space-y-2 lg:space-y-4" data-media-page-header-entry-details-content>
                        <div className="space-y-2">
                            {meta.logo ? <div className="flex justify-center lg:justify-start">
                                <img
                                    src={meta.logo.replace("/logo/medium/", "/logo/large/")}
                                    alt={meta.name}
                                    className="max-h-[7rem] max-w-[min(30rem,80vw)] object-contain object-left drop-shadow-lg"
                                    onError={e => (e.currentTarget.style.display = "none")}
                                />
                            </div> : <TextGenerateEffect
                                className="[text-shadow:_0_1px_10px_rgb(0_0_0_/_20%)] text-white/95 line-clamp-2 pb-1 text-center lg:text-left text-pretty text-[1.5rem] lg:text-[2rem] 2xl:text-[2.6rem] 2xl:leading-[3rem] xl:max-w-[50vw]"
                                words={meta.name}
                            />}
                            {!!meta.logo && <p className="text-[--muted] line-clamp-1 font-bold text-md 2xl:text-[1.4rem] text-center lg:text-left xl:max-w-[50vw]">
                                {meta.name}
                            </p>}
                        </div>

                        <div className="flex flex-wrap gap-3 lg:gap-4 items-center justify-center lg:justify-start">
                            {!!imdbToScore(meta.imdbRating) && <MediaEntryAudienceScore meanScore={imdbToScore(meta.imdbRating)} badgeClass="text-lg" />}
                            <div className="hidden lg:flex h-5 relative w-0.5 bg-[--border] rounded-full"></div>
                            {(released || year) && <p className="text-lg text-[--foreground] flex gap-1 items-center">
                                <LuCalendar /> {released && !isNaN(released.getTime())
                                ? new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(released)
                                : year}
                            </p>}
                            {!!meta.runtime && <p className="text-lg text-[--foreground] flex gap-1 items-center">
                                <LuClock /> {meta.runtime}
                            </p>}
                        </div>

                        <MediaEntryGenresList genres={genres} />

                        {!!meta.description && <Popover
                            trigger={<div
                                className="cursor-pointer line-clamp-3 col-span-2 left-[-.5rem] text-[--muted] 2xl:max-w-[50vw] hover:text-[--foreground] transition-colors duration-500 text-sm pr-2 bg-transparent rounded-[--radius-md] text-center lg:text-left"
                            >
                                {meta.description}
                            </div>}
                            className="max-w-[40rem] bg-[--background] p-4 w-[20rem] lg:w-[40rem] text-md"
                        >
                            <span className="transition-colors">{meta.description}</span>
                        </Popover>}

                        {(!!directors.length || !!meta.cast?.length) && <div className="text-sm text-[--muted] space-y-1 text-center lg:text-left xl:max-w-[50vw]">
                            {!!directors.length && <p><span className="text-[--foreground] font-semibold">Director</span> {directors.join(", ")}</p>}
                            {!!meta.cast?.length && <p className="line-clamp-1">
                                <span className="text-[--foreground] font-semibold">Cast</span> {meta.cast.slice(0, 6).join(", ")}
                            </p>}
                        </div>}

                        <div className="flex flex-row w-full gap-3 items-center justify-center lg:justify-start flex-wrap">
                            {!!downloaded && <Button
                                intent="white"
                                className="rounded-full"
                                leftIcon={<BiPlay className="text-2xl" />}
                                onClick={() => playLibraryItem(downloaded).catch((e: any) => toast.error(e?.message ?? String(e)))}
                                data-movie-play-downloaded
                            >
                                Play downloaded
                            </Button>}
                            <MovieListButton meta={meta} size="md" />
                            {!!trailerId && <TrailerModal
                                trailerId={trailerId}
                                trigger={<Button intent="gray-subtle" size="sm" className="rounded-full">Watch trailer</Button>}
                            />}
                            {!!meta.awards && <p className="text-sm text-[--muted]">{meta.awards}</p>}
                        </div>

                        <div className="mx-auto lg:mx-0 overflow-hidden" data-movie-entry-page-tabs-container>
                            <StaticTabs
                                className="lg:h-12 w-fit flex-wrap lg:flex-nowrap overflow-hidden justify-center lg:justify-start"
                                triggerClass="px-4 h-full text-[1.1rem] data-[current=true]:!text-[1.1rem] border border-transparent data-[current=true]:text-white opacity-80 data-[current=true]:opacity-100 data-[current=true]:bg-gray-300 data-[current=true]:bg-opacity-5 rounded-xl data-[current=false]:scale-95 lg:scale-100"
                                pillClass="border-transparent"
                                iconClass="size-5 hidden data-[current=true]:block"
                                items={[
                                    {
                                        name: "Torrent streaming",
                                        iconType: PiMonitorPlayDuotone,
                                        isCurrent: view === "torrentstream",
                                        onClick: () => setView("torrentstream"),
                                    },
                                    { name: "Online streaming", iconType: FiGlobe, isCurrent: view === "onlinestream", onClick: () => setView("onlinestream") },
                                ]}
                            />
                        </div>
                    </div>
                </div>
            </MediaPageHeaderDetailsContainer>
        </MediaPageHeader>
    )
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function releaseTitle(meta: Movie_Meta, t: Movie_YtsTorrent) {
    const year = movieYear(meta)
    return `${meta.name}${year ? ` (${year})` : ""} [${t.quality}${t.type ? ` ${t.type}` : ""}]`
}

function MovieTorrentSection({ meta }: { meta: Movie_Meta }) {
    const { data: yts, isLoading, isError } = useMovieTorrents(meta.id)
    const { data: library } = useMovieLibrary()
    const { data: active } = useEngineTorrents(3000)
    const serverStatus = useServerStatus()
    const { seaFetch } = useSeaQuery()
    const { data: movieSettings, refetch: refetchMovieSettings } = useMovieSettings()
    const clientName = ({ [TORRENT_CLIENT.QBITTORRENT]: "qBittorrent", [TORRENT_CLIENT.TRANSMISSION]: "Transmission" } as Record<string, string>)[
        serverStatus?.settings?.torrent?.defaultTorrentClient ?? ""]
    const [streaming, setStreaming] = React.useState<{ hash: string, title: string, imdb: string }>()
    const [busy, setBusy] = React.useState<string>()

    const torrents = React.useMemo(() => [...(yts?.torrents ?? [])].sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality) || b.seeds - a.seeds),
        [yts])

    async function start(t: Movie_YtsTorrent, mode: "stream" | "download") {
        const title = releaseTitle(meta, t)
        setBusy(t.hash)
        try {
            const { hash } = await startEngineTorrent(ytsMagnet(t.hash, title), title, mode, metaToLibraryMedia(meta))
            if (mode === "stream") setStreaming({ hash: hash || t.hash.toLowerCase(), title, imdb: meta.id })
            else toast.success("Download started, the movie will appear in your Library when it finishes")
        }
        catch (e: any) {
            toast.error(e?.message ?? "The torrent engine is unavailable")
        }
        finally {
            setBusy(undefined)
        }
    }

    async function sendToClient(t: Movie_YtsTorrent) {
        const title = releaseTitle(meta, t)
        setBusy(t.hash)
        try {
            await downloadWithTorrentClient(seaFetch, ytsMagnet(t.hash, title), t.hash.toLowerCase(), title, metaToLibraryMedia(meta))
            toast.success(`Sent to ${clientName}, the movie will appear in your Library when it finishes`)
            refetchMovieSettings()
        }
        catch (e: any) {
            toast.error(e?.message ?? `${clientName} is unavailable`)
        }
        finally {
            setBusy(undefined)
        }
    }

    const hashes = new Set(torrents.map(t => t.hash.toLowerCase()))

    return (
        <>
            <div className="space-y-4">
                <h3 className="text-xl font-semibold">Releases</h3>
                {isLoading ? <div className="flex justify-center py-10"><LoadingSpinner /></div>
                    : isError ? <LuffyError title="Media helper unavailable"><p>Restart Seanime and try again.</p></LuffyError>
                        : !torrents.length ? <LuffyError title={null}>
                            <p>No torrent releases found for this movie. Try Online streaming.</p>
                        </LuffyError>
                            : <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                                {torrents.map(t => {
                                    const hash = t.hash.toLowerCase()
                                    const saved = library?.find(x => x.hash === hash)
                                    const job = active?.find(x => x.hash === hash)
                                    const downloading = !saved && job?.mode === "download"
                                    const inClient = !saved && !!movieSettings?.external.includes(hash)
                                    return <div
                                        key={t.hash}
                                        className="border rounded-[--radius-md] bg-[--paper] p-4 flex items-center gap-4 hover:border-[--brand] transition-colors"
                                        data-movie-torrent-row
                                    >
                                        <div className="flex-1 min-w-0 space-y-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <Badge intent={qualityRank(t.quality) >= 3 ? "primary-solid" : "gray-solid"} size="lg">{t.quality}</Badge>
                                                {!!t.type && <Badge intent="gray" className="capitalize">{t.type}</Badge>}
                                                {!!t.video_codec && <Badge intent="gray">{t.video_codec}</Badge>}
                                                {!!t.audio_channels && <Badge intent="gray">{t.audio_channels}ch</Badge>}
                                            </div>
                                            <p className="text-sm text-[--muted] flex items-center gap-3">
                                                <span>{t.size}</span>
                                                <span className={cn("flex items-center gap-1", t.seeds > 20 ? "text-green-300" : t.seeds > 0
                                                    ? "text-yellow-200"
                                                    : "text-red-300")}>
                                                    {/* YTS stops counting at 100 */}
                                                    <LuUsers /> {t.seeds >= 100 ? "100+" : t.seeds} seeders
                                                </span>
                                            </p>
                                        </div>
                                        {saved ? <Button
                                            size="sm"
                                            intent="white"
                                            leftIcon={<BiPlay className="text-xl" />}
                                            onClick={() => playLibraryItem(saved).catch((e: any) => toast.error(e?.message ?? String(e)))}
                                        >
                                            Play
                                        </Button> : <Button
                                            size="sm"
                                            intent="white"
                                            leftIcon={<BiPlay className="text-xl" />}
                                            disabled={!!busy}
                                            loading={busy === t.hash}
                                            onClick={() => start(t, "stream")}
                                        >
                                            Stream
                                        </Button>}
                                        {saved ? <Badge intent="success">In Library</Badge> : <Button
                                            size="sm"
                                            intent="gray-subtle"
                                            leftIcon={<LuDownload />}
                                            disabled={!!busy || downloading}
                                            onClick={() => start(t, "download")}
                                        >
                                            {downloading ? `${Math.floor((job?.progress ?? 0) * 100)}%` : "Download"}
                                        </Button>}
                                        {!saved && !!clientName && (inClient ? <Badge intent="gray">In {clientName}</Badge> : <Button
                                            size="sm"
                                            intent="gray-subtle"
                                            leftIcon={<LuDownload />}
                                            disabled={!!busy || downloading}
                                            onClick={() => sendToClient(t)}
                                        >
                                            {clientName}
                                        </Button>)}
                                    </div>
                                })}
                            </div>}
            </div>

            {!!torrents.length && <div className="space-y-4">
                <h3 className="text-xl font-semibold">Active</h3>
                <MovieDownloads filter={t => hashes.has(t.hash.toLowerCase())} />
            </div>}

            <TorrentStreamModal
                streaming={streaming}
                onClose={played => {
                    // Cancelling before playback stops the stream so it doesn't keep using bandwidth, downloads keep going
                    const job = active?.find(x => x.hash === streaming?.hash)
                    if (!played && streaming && job?.mode !== "download") engineAction("stop", streaming.hash).catch(() => {})
                    setStreaming(undefined)
                }}
            />
        </>
    )
}

function qualityRank(q: string) {
    return q === "2160p" ? 4 : q === "1080p" ? 3 : q === "720p" ? 2 : q === "3D" ? 0 : 1
}

/** Waits for the torrent to be ready (metadata + first pieces), then hands it to the native player. */
function TorrentStreamModal({ streaming, onClose }: { streaming?: { hash: string, title: string, imdb: string }, onClose: (played?: boolean) => void }) {
    const [torrent, setTorrent] = React.useState<Movie_EngineTorrent>()
    const [error, setError] = React.useState<string>()

    React.useEffect(() => {
        setTorrent(undefined)
        setError(undefined)
        if (!streaming) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout>
        let missing = 0

        const poll = async () => {
            try {
                const list = await fetchEngineTorrents()
                if (cancelled) return
                const t = list.find(x => x.hash.toLowerCase() === streaming.hash.toLowerCase())
                setTorrent(t)
                if (!t && ++missing > 10) return setError("The torrent was stopped")
                if (t?.error) return setError(t.error)
                if (t?.ready) {
                    const file = largestPlayableFile(t)
                    if (!file) return setError("No supported video files in this torrent")
                    await playEngineFile(file, streaming.title, streaming.imdb)
                    if (!cancelled) onClose(true)
                    return
                }
            }
            catch (e: any) {
                if (cancelled) return
                return setError(e?.message ?? String(e))
            }
            timer = setTimeout(poll, 1500)
        }
        poll()
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [streaming?.hash])

    return (
        <Modal
            open={!!streaming}
            onOpenChange={v => !v && onClose()}
            title="Preparing stream"
            contentClass="max-w-xl"
        >
            <div className="space-y-4">
                <p className="font-medium line-clamp-2">{streaming?.title}</p>
                {error ? <p className="text-red-300">{error}</p> : <>
                    <ProgressBar isIndeterminate={!torrent?.progress} value={Math.round((torrent?.progress ?? 0) * 100)} size="sm" />
                    <p className="text-sm text-[--muted]">
                        {!torrent ? "Starting torrent…" : `Finding peers and buffering… ${torrent.peers} peers · ${formatBytes(torrent.downloadSpeed)}/s`}
                    </p>
                </>}
            </div>
        </Modal>
    )
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function MovieOnlineSection({ meta }: { meta: Movie_Meta }) {
    const { data: matches, isLoading: hydraLoading } = useMovieHydraMatches(meta.name)
    const [streaming, setStreaming] = React.useState<{ sources: Movie_StreamSource[], key: number }>()

    const year = movieYear(meta)
    const ref = React.useMemo<Movie_StreamRef>(() => {
        const name = meta.name.toLowerCase()
        const score = (title: string) => {
            const t = title.toLowerCase()
            return (t === name ? 4 : t.includes(name) ? 2 : 0) + (year && t.includes(String(year)) ? 1 : 0)
        }
        const hydra = [...(matches ?? [])].sort((a, b) => score(b.title) - score(a.title))[0]
        return { imdb: meta.id, tmdb: meta.moviedb_id, title: meta.name, year: year ? Number(year) : undefined, hydraId: hydra && score(hydra.title) >= 2 ? hydra.id : undefined }
    }, [matches, meta, year])

    const available = MOVIE_STREAM_SOURCES.filter(s => !!s.url(ref))
    const play = (sources: Movie_StreamSource[]) => setStreaming({ sources, key: Date.now() })
    // The website that played last time is tried first, it is the most likely to work again
    const playAll = () => {
        const last = readLastSource()
        play([...available].sort((a, b) => Number(b.id === last) - Number(a.id === last)))
    }

    return (
        <>
            <div className="space-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <h3 className="text-xl font-semibold flex-1">Online streaming</h3>
                    <Button
                        intent="white"
                        className="rounded-full"
                        leftIcon={<BiPlay className="text-2xl" />}
                        disabled={!available.length}
                        onClick={playAll}
                    >
                        Play
                    </Button>
                </div>
                <p className="text-sm text-[--muted]">
                    Play tries the websites one by one until one plays, starting with the one that worked last. Choose a website below to use it instead.
                </p>
                {!available.length && !hydraLoading ? <LuffyError title={null}><p>No website can find this movie.</p></LuffyError>
                    : <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-3">
                        {MOVIE_STREAM_SOURCES.map(source => {
                            const url = source.url(ref)
                            const pending = !url && source.id === "hydrahd" && hydraLoading
                            return (
                                <button
                                    key={source.id}
                                    type="button"
                                    disabled={!url}
                                    data-movie-stream-source={source.id}
                                    className="border rounded-[--radius-md] bg-[--paper] px-4 py-3 flex items-center gap-3 text-left transition-colors hover:border-[--brand] disabled:opacity-40 disabled:hover:border-[--border]"
                                    onClick={() => play([source])}
                                >
                                    <PiMonitorPlayDuotone className="text-2xl flex-none text-[--muted]" />
                                    <span className="flex-1 min-w-0">
                                        <span className="block font-medium truncate">{source.name}</span>
                                        <span className="block text-xs text-[--muted] truncate">
                                            {url ? new URL(url).hostname.replace(/^www\./, "") : pending ? "Searching…" : "Not available"}
                                        </span>
                                    </span>
                                    {pending ? <LoadingSpinner className="size-5 m-0" /> : <BiPlay className="text-2xl flex-none" />}
                                </button>
                            )
                        })}
                    </div>}
            </div>

            <OnlineStreamModal
                streaming={streaming}
                ref_={ref}
                onClose={() => setStreaming(undefined)}
                onTryAll={playAll}
            />
        </>
    )
}
