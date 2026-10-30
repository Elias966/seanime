import { TrailerModal } from "@/app/(main)/_features/anime/_components/trailer-modal"
import { MediaEntryAudienceScore, MediaEntryGenresList } from "@/app/(main)/_features/media/_components/media-entry-metadata-components"
import { MediaEntryPageLoadingDisplay } from "@/app/(main)/_features/media/_components/media-entry-page-loading-display"
import { MediaPageHeader, MediaPageHeaderDetailsContainer } from "@/app/(main)/_features/media/_components/media-page-header-components"
import { ENTRY_VIEW_SHELL_TRANSITION } from "@/app/(main)/entry/_containers/entry-view-transition"
import { imdbToScore, MovieEntryCard, MovieListButton } from "@/app/(main)/movies/_components/movie-entry-card"
import { MovieCarousel } from "@/app/(main)/movies/_containers/movie-carousel"
import { OnlineStreamModal, readLastSource } from "@/app/(main)/movies/_containers/online-stream-modal"
import {
    Drama_Detail,
    dramaBaseTitle,
    KISSKH_PREFIX,
    ASIAFLIX_STREAM_SOURCE,
    KISSKH_STREAM_SOURCE,
    Movie_Meta,
    Movie_StreamRef,
    Movie_StreamSource,
    Movie_Video,
    movieBackground,
    moviePoster,
    movieTrailerId,
    playMovieUrl,
    SERIES_STREAM_SOURCES,
    TORRENT_ENGINE,
    useDramaCatalog,
    useDramaDetail,
    useDramaMatch,
    useMovieMeta,
    useRelatedTitles,
    useSeriesFiles,
    useTorrentSource,
    fetchSeriesTorrents,
    fetchDownloadSubtitles,
    offlineImage,
    pickEpisodeTorrent,
    SERIES_FIREFOX_SITES,
} from "@/app/(main)/movies/_lib/movies.api"
import { SeriesDownloadDrawer, SeriesStreamModal, Series_TorrentStream, startSeriesStream } from "@/app/(main)/series/_containers/series-downloads"
import { imageShimmer } from "@/components/shared/image-helpers"
import { LuffyError } from "@/components/shared/luffy-error"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { SeaImage } from "@/components/shared/sea-image"
import { TextGenerateEffect } from "@/components/shared/text-generate-effect"
import { Button } from "@/components/ui/button"
import { Popover } from "@/components/ui/popover"
import { Select } from "@/components/ui/select"
import { useSearchParams } from "@/lib/navigation"
import { motion } from "motion/react"
import React from "react"
import { BiDownload, BiPlay } from "react-icons/bi"
import { toast } from "sonner"
import { LuCalendar } from "react-icons/lu"

const SERIES_LAST_SOURCE_KEY = "seanime-series-last-stream-source"

/** A kisskh drama shown like a Cinemeta series, its episodes all in season 1. */
function dramaToMeta(d: Drama_Detail): Movie_Meta {
    return {
        id: KISSKH_PREFIX + d.id,
        type: "series",
        name: d.title,
        poster: d.thumbnail,
        background: d.thumbnail,
        description: d.description,
        releaseInfo: d.releaseDate?.slice(0, 4),
        country: d.country,
        status: d.status,
        genres: [d.country, d.type === "TVSeries" ? "" : d.type].filter((g): g is string => !!g),
        videos: [...d.episodes].sort((a, b) => a.number - b.number).map(e => ({
            id: String(e.id),
            season: 1,
            episode: e.number,
            name: `Episode ${e.number}`,
        })),
    }
}

const episodeNumber = (v: Movie_Video) => v.episode ?? v.number ?? 0

export default function Page() {
    const searchParams = useSearchParams()
    const id = searchParams.get("id") || undefined
    const dramaId = searchParams.get("drama") || undefined
    const series = useMovieMeta(id, "series")
    const drama = useDramaDetail(dramaId)
    const meta = React.useMemo(() => dramaId ? (drama.data ? dramaToMeta(drama.data) : undefined) : series.data, [dramaId, drama.data, series.data])
    const { isLoading, isError } = dramaId ? drama : series

    React.useLayoutEffect(() => {
        if (meta?.name) document.title = `${meta.name} | Seanime`
    }, [meta?.name])

    if (isLoading) return <MediaEntryPageLoadingDisplay />
    if (isError || !meta) return <LuffyError title="Series not found">
        <p>This series could not be loaded, check your connection.</p>
    </LuffyError>

    const genre = dramaId ? undefined : (meta.genres ?? meta.genre ?? [])[0]

    return (
        <div data-series-entry-page data-series-id={meta.id} key={meta.id}>
            <div data-entry-back-navigation>
                <button type="button" data-entry-back-button aria-label="Go back" title="Go back" onClick={() => window.SeanimeNavigation?.back()}>
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="m12 19-7-7 7-7M5 12h14" />
                    </svg>
                </button>
            </div>

            <SeriesMetaSection meta={meta} />

            <div className="px-4 md:px-8 relative z-[8]" data-series-entry-page-content-container>
                <PageWrapper className="relative 2xl:order-first pb-10 lg:min-h-[calc(100vh-10rem)] space-y-8" {...ENTRY_VIEW_SHELL_TRANSITION}>
                    <SeriesEpisodes meta={meta} drama={drama.data} />

                    <SeriesRelated meta={meta} drama={drama.data} />

                    {!!genre && <div className="space-y-2 pt-6" data-series-entry-more-like-this>
                        <h2>More like this</h2>
                        <MovieCarousel catalog={{ type: "series", catalog: "top", genre }} excludeId={meta.id} lazy />
                    </div>}
                </PageWrapper>
            </div>
        </div>
    )
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/** Prequels, sequels and spin-offs (Wikidata), and for dramas the other seasons and movies of the same name (kisskh) */
function SeriesRelated({ meta, drama }: { meta: Movie_Meta, drama?: Drama_Detail }) {
    const match = useDramaMatch(drama).data
    const imdb = drama ? match?.imdb : meta.id
    const related = useRelatedTitles(imdb).data ?? []
    const base = drama ? dramaBaseTitle(drama.title) : ""
    const seasons = useDramaCatalog({ search: base, type: 1 }, !!base).data ?? []
    const movies = useDramaCatalog({ search: base, type: 2 }, !!base).data ?? []
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    const items = [
        ...seasons.map(m => ({ meta: m, relation: "Season" })),
        ...movies.map(m => ({ meta: m, relation: "Movie" })),
    ].filter(x => x.meta.id !== meta.id && norm(x.meta.name).startsWith(norm(base)))
        .concat(related.map(r => ({
            meta: { id: r.imdb, type: r.type, name: r.name, year: r.year, poster: `https://images.metahub.space/poster/medium/${r.imdb}/img` } as Movie_Meta,
            relation: r.relation,
        })))
        .filter((x, i, all) => all.findIndex(y => y.meta.id === x.meta.id) === i)

    if (!items.length) return null
    return (
        <div className="space-y-2 pt-6" data-series-related>
            <h2>Prequels and sequels</h2>
            <div className="flex gap-4 overflow-x-auto pb-2">
                {items.slice(0, 20).map(x => <div key={x.meta.id} className="flex-none w-[200px] md:w-[230px]" data-series-related-item={x.relation}>
                    <p className="text-sm text-[--muted] font-medium mb-1">{x.relation}</p>
                    <MovieEntryCard meta={x.meta} containerClassName="w-full" showTrailer={false} hideable={false} />
                </div>)}
            </div>
        </div>
    )
}

function SeriesMetaSection({ meta }: { meta: Movie_Meta }) {
    const trailerId = movieTrailerId(meta)
    const genres = meta.genres ?? meta.genre ?? []
    const poster = meta.id.startsWith(KISSKH_PREFIX) ? meta.poster : moviePoster(meta.poster, "large")
    const background = meta.id.startsWith(KISSKH_PREFIX) ? meta.background : movieBackground(meta)

    return (
        <MediaPageHeader backgroundImage={background} coverImage={poster}>
            <MediaPageHeaderDetailsContainer>
                <div className="flex flex-col lg:flex-row gap-8" data-media-page-header-entry-details>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15 }}
                        className="flex-none aspect-[6/8] max-w-[150px] mx-auto lg:m-0 h-auto sm:max-w-[200px] lg:max-w-[230px] w-full relative rounded-[--radius-md] overflow-hidden bg-[--background] shadow-md block"
                    >
                        {!!poster && <SeaImage
                            src={poster}
                            alt="cover image"
                            fill
                            priority
                            placeholder={imageShimmer(700, 475)}
                            className="object-cover object-center"
                        />}
                    </motion.div>

                    <div className="space-y-2 lg:space-y-4" data-media-page-header-entry-details-content>
                        <div className="space-y-2">
                            {meta.logo ? <div className="flex justify-center lg:justify-start">
                                <img
                                    src={offlineImage(meta.logo.replace("/logo/medium/", "/logo/large/"))}
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
                            {!!meta.releaseInfo && <p className="text-lg text-[--foreground] flex gap-1 items-center">
                                <LuCalendar /> {meta.releaseInfo}
                            </p>}
                            {!!meta.status && <p className="text-lg text-[--muted]">{meta.status}</p>}
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

                        {!!meta.cast?.length && <p className="text-sm text-[--muted] line-clamp-1 text-center lg:text-left xl:max-w-[50vw]">
                            <span className="text-[--foreground] font-semibold">Cast</span> {meta.cast.slice(0, 6).join(", ")}
                        </p>}

                        <div className="flex flex-row w-full gap-3 items-center justify-center lg:justify-start flex-wrap">
                            <MovieListButton meta={meta} size="md" />
                            {!!trailerId && <TrailerModal
                                trailerId={trailerId}
                                trigger={<Button intent="gray-subtle" size="sm" className="rounded-full">Watch trailer</Button>}
                            />}
                        </div>
                    </div>
                </div>
            </MediaPageHeaderDetailsContainer>
        </MediaPageHeader>
    )
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/** Seasons and their episodes, each one plays through the streaming websites (kisskh for its dramas). */
function SeriesEpisodes({ meta, drama }: { meta: Movie_Meta, drama?: Drama_Detail }) {
    const videos = React.useMemo(() => (meta.videos ?? []).filter(v => v.season !== undefined), [meta.videos])
    // Season 0 holds the specials, it goes last
    const seasons = React.useMemo(() => [...new Set(videos.map(v => v.season))].sort((a, b) => (a || 1e6) - (b || 1e6)), [videos])
    const [season, setSeason] = React.useState<number>()
    const current = season ?? seasons[0]
    const episodes = React.useMemo(() => videos.filter(v => v.season === current).sort((a, b) => episodeNumber(a) - episodeNumber(b)), [videos, current])

    const [playing, setPlaying] = React.useState<{ ref: Movie_StreamRef, sources: Movie_StreamSource[], key: number }>()
    // Dramas play from kisskh, and from the series websites too once the drama is matched to its IMDb entry
    const match = useDramaMatch(drama).data
    const allSources = drama ? [KISSKH_STREAM_SOURCE, ASIAFLIX_STREAM_SOURCE, ...(match?.tmdb ? SERIES_STREAM_SOURCES : [])] : SERIES_STREAM_SOURCES
    const sourcesFor = (ref: Movie_StreamRef) => allSources.filter(s => !!s.url(ref))

    const refFor = (v: Movie_Video): Movie_StreamRef => {
        const n = episodeNumber(v)
        const title = `${meta.name} - ${drama ? "" : `S${String(v.season).padStart(2, "0")}`}E${String(n).padStart(2, "0")}${v.name && !/^episode \d+$/i.test(v.name) ? ` - ${v.name}` : ""}`
        if (drama) return {
            title, episode: n, drama: { id: String(drama.id), episodeId: Number(v.id), title: drama.title },
            ...(match?.tmdb && { imdb: match.imdb, tmdb: match.tmdb, season: match.season }),
        }
        return { imdb: meta.id, tmdb: meta.moviedb_id, title, season: v.season, episode: n }
    }
    // "auto" tries every website, starting with the one that worked last; picking one plays only from it
    // Series use 1337x unless another source was picked, dramas are rarely there and keep their own sites
    const [dramaSourceId, setDramaSourceId] = React.useState("auto")
    const [seriesSourceId, setSeriesSourceId] = useTorrentSource<string>("series-play", "1337x")
    const sourceId = drama ? dramaSourceId : seriesSourceId
    const setSourceId = drama ? setDramaSourceId : setSeriesSourceId
    const firefoxSite = !drama && SERIES_FIREFOX_SITES.find(s => `firefox:${s.id}` === sourceId)
    const [finding, setFinding] = React.useState<string>()
    const [torrentStream, setTorrentStream] = React.useState<Series_TorrentStream>()
    const playTorrent = async (v: Movie_Video) => {
        const n = episodeNumber(v)
        setFinding(v.id)
        try {
            const t = pickEpisodeTorrent(await fetchSeriesTorrents(meta.id, meta.name, "1337x"), v.season, n)
            if (!t) return toast.error("1337x has no release of this episode, choose another source")
            setTorrentStream(await startSeriesStream(t, refFor(v).title, meta.name, meta.id, v.season, n))
        }
        catch (e: any) {
            toast.error(e?.message ?? String(e))
        }
        finally {
            setFinding(undefined)
        }
    }
    const play = (v: Movie_Video) => {
        if (!drama && sourceId === "1337x") return void playTorrent(v)
        if (firefoxSite) {
            window.SeanimeMediaHub?.browse?.(firefoxSite.id)
                .then(() => toast.success(`${firefoxSite.name} opened in Firefox`))
                .catch((e: any) => toast.error(e?.message ?? String(e)))
            return
        }
        const ref = refFor(v)
        const all = sourcesFor(ref)
        const picked = all.filter(s => s.id === sourceId)
        const last = readLastSource(SERIES_LAST_SOURCE_KEY)
        const sources = picked.length ? picked : [...all].sort((a, b) => Number(b.id === last) - Number(a.id === last))
        setPlaying({ ref, sources, key: Date.now() })
    }
    const sourceChoices = allSources

    // Episodes saved on disk (torrents and download sites) play from the file
    const [downloadOpen, setDownloadOpen] = React.useState(false)
    const files = useSeriesFiles(meta.name, downloadOpen ? 5000 : 20000).data
    const fileFor = (v: Movie_Video) => {
        const n = episodeNumber(v)
        return files?.find(f => f.complete && f.episode === n && (f.season === null || f.season === v.season))
    }

    const now = Date.now()
    const aired = (v: Movie_Video) => !v.released || isNaN(Date.parse(v.released)) || Date.parse(v.released) <= now

    if (!videos.length) return <LuffyError title={null}><p>No episodes are listed for this series yet.</p></LuffyError>
    const canStream = drama || !!meta.moviedb_id || sourceId === "1337x" || !!firefoxSite

    return (
        <div className="space-y-4" data-series-episodes>
            <div className="flex items-center gap-4 flex-wrap">
                <h3 className="text-xl font-semibold flex-1">Episodes</h3>
                <Button intent="gray-subtle" size="sm" className="rounded-full" leftIcon={<BiDownload className="text-lg" />}
                    onClick={() => setDownloadOpen(true)} data-series-download-button>Download</Button>
                {(!drama || sourceChoices.length > 1) && <div className="w-48">
                    <Select
                        value={sourceId}
                        onValueChange={v => setSourceId(v || "auto")}
                        options={[
                            ...(drama ? [] : [{ value: "1337x", label: "1337x" }]),
                            { value: "auto", label: drama ? "Any source" : "Any website" },
                            ...sourceChoices.map(s => ({ value: s.id, label: s.name })),
                            ...(drama ? [] : SERIES_FIREFOX_SITES.map(s => ({ value: `firefox:${s.id}`, label: `${s.name} (Firefox)` }))),
                        ]}
                        data-series-source-select
                    />
                </div>}
                {seasons.length > 1 && <div className="w-48">
                    <Select
                        value={String(current)}
                        onValueChange={v => setSeason(Number(v))}
                        options={seasons.map(s => ({ value: String(s), label: s === 0 ? "Specials" : `Season ${s}` }))}
                        data-series-season-select
                    />
                </div>}
            </div>
            <p className="text-sm text-[--muted]">
                {!drama && sourceId === "1337x" ? "Play streams the episode's best seeded release from 1337x. Pick another source to change it."
                    : firefoxSite ? `${firefoxSite.name} asks for a human check, so Play opens the site in Firefox.`
                    : canStream ? sourceId === "auto"
                    ? "Play tries the streaming websites one by one until one plays, starting with the one that worked last. Pick a source to use only that one. A website's servers show while it looks for the episode, pick one if the first doesn't work."
                    : "Play uses only the chosen source. Its servers show while it looks for the episode; if none plays, choose another source or Any source."
                    : "No streaming website can find this series."}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                {episodes.map(v => {
                    const n = episodeNumber(v)
                    const out = aired(v)
                    const file = fileFor(v)
                    return (
                        <div
                            key={v.id}
                            className="border rounded-[--radius-md] bg-[--paper] flex gap-3 p-2 items-center"
                            data-series-episode={`${v.season}:${n}`}
                        >
                            <div className="relative flex-none w-32 aspect-video rounded-[--radius] overflow-hidden bg-[--background]">
                                {!!v.thumbnail && <img
                                    src={offlineImage(v.thumbnail)}
                                    alt=""
                                    loading="lazy"
                                    className="absolute inset-0 w-full h-full object-cover"
                                    onError={e => (e.currentTarget.style.display = "none")}
                                />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium line-clamp-1">{n}. {v.name || v.title || `Episode ${n}`}</p>
                                {!!(v.overview || v.description) && <p className="text-xs text-[--muted] line-clamp-2">{v.overview || v.description}</p>}
                                {!out && <p className="text-xs text-[--muted]">Airs {new Date(v.released!).toLocaleDateString()}</p>}
                                {!!file && <p className="text-xs text-green-300" data-series-episode-downloaded>Downloaded</p>}
                            </div>
                            {!!file && <Button
                                intent="primary-subtle"
                                size="sm"
                                className="rounded-full flex-none"
                                leftIcon={<BiPlay className="text-xl" />}
                                onClick={() => fetchDownloadSubtitles(file.subs, `${meta.id}:${v.season}:${n}`, file.name).then(subtitles => playMovieUrl(TORRENT_ENGINE + file.url, refFor(v).title, subtitles)).catch((e: any) => toast.error(e?.message ?? String(e)))}
                                data-series-episode-play-file
                            >
                                File
                            </Button>}
                            <Button
                                intent="gray-subtle"
                                size="sm"
                                className="rounded-full flex-none"
                                leftIcon={<BiPlay className="text-xl" />}
                                disabled={!canStream || !out || !!finding}
                                loading={finding === v.id}
                                onClick={() => play(v)}
                                data-series-episode-play
                            >
                                Play
                            </Button>
                        </div>
                    )
                })}
            </div>

            <SeriesDownloadDrawer
                open={downloadOpen}
                onOpenChange={setDownloadOpen}
                title={meta.name}
                imdb={drama ? match?.imdb : meta.id}
                isDrama={!!drama}
                season={current || 1}
                seasons={seasons}
                episodesOf={s => videos.filter(v => v.season === s).map(episodeNumber).sort((a, b) => a - b)}
                onStream={setTorrentStream}
            />
            <SeriesStreamModal streaming={torrentStream} onClose={() => setTorrentStream(undefined)} />

            {playing && <OnlineStreamModal
                streaming={{ sources: playing.sources, key: playing.key }}
                ref_={playing.ref}
                onClose={() => setPlaying(undefined)}
                onTryAll={() => setPlaying(p => p && { ...p, sources: sourcesFor(p.ref), key: Date.now() })}
                lastSourceKey={SERIES_LAST_SOURCE_KEY}
            />}
        </div>
    )
}
