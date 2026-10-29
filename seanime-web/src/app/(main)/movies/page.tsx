import { MediaCardGrid } from "@/app/(main)/_features/media/_components/media-card-grid"
import { MediaGenreSelector } from "@/app/(main)/_features/media/_components/media-genre-selector"
import { MovieEntryCard } from "@/app/(main)/movies/_components/movie-entry-card"
import { MoviesPageHeader } from "@/app/(main)/movies/_components/movies-page-header"
import { MovieCarousel } from "@/app/(main)/movies/_containers/movie-carousel"
import { MovieDownloads } from "@/app/(main)/movies/_containers/movie-downloads"
import {
    listItemImdb,
    MOVIE_GENRES,
    Movie_LibraryItem,
    Movie_Meta,
    playLibraryItem,
    scanLibraryDownloads,
    useInfiniteMovieCatalog,
    useMovieLibrary,
    useMovieList,
    useMovieMeta,
} from "@/app/(main)/movies/_lib/movies.api"
import { LuffyError } from "@/components/shared/luffy-error"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { StaticTabs } from "@/components/ui/tabs"
import { TextInput } from "@/components/ui/text-input"
import { useDebounce } from "@/hooks/use-debounce"
import { useRouter, useSearchParams } from "@/lib/navigation"
import { AnimatePresence, motion } from "motion/react"
import React from "react"
import { FiSearch } from "react-icons/fi"
import { LuRefreshCw } from "react-icons/lu"
import { toast } from "sonner"

type MoviesTab = "discover" | "browse" | "list" | "library" | "downloads"

const TAB_TRANSITION = {
    initial: { opacity: 0, y: 60 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, scale: 0.99 },
    transition: { duration: 0.35 },
}

const CURRENT_YEAR = new Date().getFullYear()

export default function Page() {

    const router = useRouter()
    const searchParams = useSearchParams()
    const tab = (searchParams.get("tab") as MoviesTab) || "discover"
    const setTab = (t: MoviesTab) => router.push(t === "discover" ? "/movies" : `/movies?tab=${t}`)

    const [heroItems, setHeroItems] = React.useState<Movie_Meta[]>()

    return (
        <>
            <MoviesPageHeader items={heroItems} />
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.6 }}
                className="p-4 sm:p-8 space-y-10 pb-10 relative z-[4]"
                data-movies-page-container
            >
                <div
                    className="lg:absolute w-full lg:-top-10 left-0 flex gap-4 p-4 items-center justify-center flex-wrap"
                    data-movies-page-header-tabs-container
                >
                    <div className="max-w-fit border rounded-full overflow-hidden">
                        <StaticTabs
                            className="h-full py-0"
                            triggerClass="px-4 py-2 h-full rounded-full border-transparent"
                            pillClass="rounded-full border-transparent"
                            items={[
                                { name: "Movies", isCurrent: tab === "discover", onClick: () => setTab("discover") },
                                { name: "Browse", isCurrent: tab === "browse", onClick: () => setTab("browse") },
                                { name: "My List", isCurrent: tab === "list", onClick: () => setTab("list") },
                                { name: "Library", isCurrent: tab === "library", onClick: () => setTab("library") },
                                { name: "Downloads", isCurrent: tab === "downloads", onClick: () => setTab("downloads") },
                            ]}
                        />
                    </div>
                </div>

                <AnimatePresence mode="wait" initial={false}>
                    {tab === "discover" && <PageWrapper
                        key="discover"
                        className="relative 2xl:order-first pb-10 pt-4 space-y-8"
                        {...TAB_TRANSITION}
                        data-movies-page-discover-container
                    >
                        <div className="space-y-2 z-[5] relative">
                            <h2>Trending Right Now</h2>
                            <MovieCarousel catalog={{ catalog: "top" }} withGenreSelector onData={d => !heroItems && setHeroItems(d)} />
                        </div>
                        <div className="space-y-2 z-[5] relative">
                            <h2>New in {CURRENT_YEAR}</h2>
                            <MovieCarousel catalog={{ catalog: "year", genre: String(CURRENT_YEAR) }} lazy />
                        </div>
                        <div className="space-y-2 z-[5] relative">
                            <h2>Action & Adventure</h2>
                            <MovieCarousel catalog={{ catalog: "top", genre: "Action" }} lazy />
                        </div>
                        <div className="space-y-2 z-[5] relative">
                            <h2>Animation</h2>
                            <MovieCarousel catalog={{ catalog: "top", genre: "Animation" }} lazy />
                        </div>
                        <div className="space-y-2 z-[5] relative">
                            <h2>Sci-Fi</h2>
                            <MovieCarousel catalog={{ catalog: "top", genre: "Sci-Fi" }} lazy />
                        </div>
                        <div className="space-y-2 z-[5] relative">
                            <h2>Horror & Thrillers</h2>
                            <MovieCarousel catalog={{ catalog: "top", genre: "Horror" }} lazy />
                        </div>
                        <div className="space-y-2 z-[5] relative">
                            <h2>Comedy</h2>
                            <MovieCarousel catalog={{ catalog: "top", genre: "Comedy" }} lazy />
                        </div>
                        <div className="space-y-2 z-[5] relative">
                            <h2>Last Year's Best</h2>
                            <MovieCarousel catalog={{ catalog: "year", genre: String(CURRENT_YEAR - 1) }} lazy />
                        </div>
                    </PageWrapper>}

                    {tab === "browse" && <PageWrapper key="browse" className="relative pb-10 pt-4 space-y-6" {...TAB_TRANSITION}>
                        <MoviesBrowse />
                    </PageWrapper>}

                    {tab === "list" && <PageWrapper key="list" className="relative pb-10 pt-4 space-y-6" {...TAB_TRANSITION}>
                        <h2>My List</h2>
                        <MoviesMyList />
                    </PageWrapper>}

                    {tab === "library" && <PageWrapper key="library" className="relative pb-10 pt-4 space-y-6" {...TAB_TRANSITION}>
                        <MoviesLibrary />
                    </PageWrapper>}

                    {tab === "downloads" && <PageWrapper key="downloads" className="relative pb-10 pt-4 space-y-6 max-w-5xl mx-auto" {...TAB_TRANSITION}>
                        <h2>Downloads & Streams</h2>
                        <MovieDownloads />
                    </PageWrapper>}
                </AnimatePresence>
            </motion.div>
        </>
    )
}

function MoviesBrowse() {
    const searchParams = useSearchParams()
    const [query, setQuery] = React.useState(searchParams.get("q") ?? "")
    const search = useDebounce(query.trim(), 500)
    const [genre, setGenre] = React.useState<string>()

    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, isError } = useInfiniteMovieCatalog(
        search ? { catalog: "top", search } : { catalog: "top", genre })

    const items = React.useMemo(() => {
        const seen = new Set<string>()
        return (data?.pages.flat() ?? []).filter(m => !seen.has(m.id) && seen.add(m.id))
    }, [data])

    return (
        <>
            <div className="max-w-2xl mx-auto">
                <TextInput
                    leftIcon={<FiSearch />}
                    placeholder="Search movies…"
                    value={query}
                    onValueChange={setQuery}
                    className="rounded-full"
                    autoFocus
                />
            </div>

            {!search && <MediaGenreSelector
                items={[
                    { name: "All", isCurrent: !genre, onClick: () => setGenre(undefined) },
                    ...MOVIE_GENRES.map(g => ({ name: g, isCurrent: genre === g, onClick: () => setGenre(g) })),
                ]}
            />}

            {isLoading ? <div className="flex justify-center py-10"><LoadingSpinner /></div> : isError
                ? <LuffyError title={null}><p>Could not load movies, check your connection.</p></LuffyError>
                : <MediaCardGrid>
                    {items.map(meta => <MovieEntryCard key={meta.id} meta={meta} />)}
                </MediaCardGrid>}

            {hasNextPage && <div className="flex justify-center">
                <Button intent="gray-subtle" className="rounded-full" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
                    Load more
                </Button>
            </div>}
        </>
    )
}

function MoviesMyList() {
    const { data, isLoading, isError } = useMovieList()

    const items = React.useMemo<Movie_Meta[]>(() => {
        const seen = new Set<string>()
        return (data ?? []).flatMap(item => {
            const id = listItemImdb(item)
            if (!id || seen.has(id)) return []
            seen.add(id)
            return [{
                id,
                type: "movie" as const,
                name: item.title,
                poster: item.poster || `https://images.metahub.space/poster/medium/${id}/img`,
                background: item.background,
                year: item.year ? String(item.year) : undefined,
            }]
        }).reverse()
    }, [data])

    if (isLoading) return <div className="flex justify-center py-10"><LoadingSpinner /></div>
    if (isError) return <LuffyError title="Media helper unavailable">
        <p>Restart Seanime to load your list.</p>
    </LuffyError>

    if (!items.length) return <LuffyError title={null}>
        <p>Your list is empty. Use the bookmark button on a movie to save it here.</p>
    </LuffyError>

    return <MediaCardGrid>
        {items.map(meta => <MovieEntryCard key={meta.id} meta={meta} showTrailer={false} />)}
    </MediaCardGrid>
}

/** Finished downloads, playable from disk. */
function MoviesLibrary() {
    const { data, isLoading, isError, refetch } = useMovieLibrary()
    const [scanning, setScanning] = React.useState(false)

    // Finished downloads the Library has no entry for (from before it existed, or copied in by hand) are added on refresh
    const refresh = React.useCallback(async (quiet: boolean) => {
        setScanning(true)
        try {
            const { added, unidentified } = await scanLibraryDownloads()
            if (added) await refetch()
            if (added) toast.success(`Added ${added} movie${added > 1 ? "s" : ""} to the Library`)
            else if (!quiet) toast.info("No new finished movies found")
            if (unidentified.length && !quiet) toast.warning(`Could not identify: ${unidentified.join(", ")}`)
        }
        catch (e: any) {
            if (!quiet) toast.error(e?.message ?? String(e))
        }
        finally {
            setScanning(false)
        }
    }, [refetch])

    React.useEffect(() => {
        refresh(true)
    }, [])

    return <>
        <div className="flex items-center gap-4">
            <h2 className="flex-1">Library</h2>
            <Button
                intent="gray-subtle"
                className="rounded-full"
                leftIcon={<LuRefreshCw />}
                loading={scanning}
                onClick={() => refresh(false)}
                data-movies-library-refresh
            >
                Refresh
            </Button>
        </div>
        {isLoading ? <div className="flex justify-center py-10"><LoadingSpinner /></div> : isError
            ? <LuffyError title="Torrent engine unavailable">
                <p>Restart Seanime to load your downloaded movies.</p>
            </LuffyError>
            : !data?.length
                ? <LuffyError title={null}>
                    <p>No downloaded movies yet. Open a movie, go to Torrent streaming and press Download.</p>
                </LuffyError>
                : <MediaCardGrid data-movies-library>
                    {data.map(item => <MovieLibraryCard key={item.hash} item={item} />)}
                </MediaCardGrid>}
    </>
}

function MovieLibraryCard({ item }: { item: Movie_LibraryItem }) {
    // Full details give the card its trailer preview, the saved ones are shown until they load
    const { data: meta } = useMovieMeta(item.imdb)
    const shown = React.useMemo<Movie_Meta>(() => meta ?? {
        id: item.imdb,
        type: "movie",
        name: item.title,
        poster: item.poster || `https://images.metahub.space/poster/medium/${item.imdb}/img`,
        background: item.background,
        year: item.year,
    }, [meta, item])

    return <MovieEntryCard
        meta={shown}
        onWatch={() => playLibraryItem(item).catch((e: any) => toast.error(e?.message ?? String(e)))}
    />
}
