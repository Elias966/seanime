import { MediaCardGrid } from "@/app/(main)/_features/media/_components/media-card-grid"
import { MediaGenreSelector } from "@/app/(main)/_features/media/_components/media-genre-selector"
import { MovieEntryCard } from "@/app/(main)/movies/_components/movie-entry-card"
import { MoviesPageHeader } from "@/app/(main)/movies/_components/movies-page-header"
import { MovieCarousel } from "@/app/(main)/movies/_containers/movie-carousel"
import { MovieDownloads } from "@/app/(main)/movies/_containers/movie-downloads"
import { SeriesLibrary } from "@/app/(main)/series/_containers/series-downloads"
import {
    ASIAN_DRAMA_GENRE,
    browseYears,
    DRAMA_COUNTRIES,
    fetchMovieMeta,
    listItemMeta,
    Movie_Meta,
    SERIES_GENRES_WITH_DRAMAS,
    useHiddenMovies,
    useBrowseCatalog,
    useInfiniteDramaCatalog,
    useInfiniteMovieCatalog,
    useMovieList,
} from "@/app/(main)/movies/_lib/movies.api"
import { LuffyError } from "@/components/shared/luffy-error"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { AppLayoutGrid, AppLayoutStack } from "@/components/ui/app-layout"
import { Button, IconButton } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { cn } from "@/components/ui/core/styling"
import { Select } from "@/components/ui/select"
import { StaticTabs } from "@/components/ui/tabs"
import { TextInput } from "@/components/ui/text-input"
import { useDebounce } from "@/hooks/use-debounce"
import { useRouter, useSearchParams } from "@/lib/navigation"
import { useQueries } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import React from "react"
import { BiCalendarCheck, BiTag, BiTrash, BiTv, BiWorld } from "react-icons/bi"
import { FaSortAmountDown } from "react-icons/fa"
import { FiSearch } from "react-icons/fi"

type SeriesTab = "discover" | "browse" | "list" | "library" | "downloads"

const TAB_TRANSITION = {
    initial: { opacity: 0, y: 60 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, scale: 0.99 },
    transition: { duration: 0.35 },
}

const CURRENT_YEAR = new Date().getFullYear()
/** Cinemeta calls cartoons "Animation" */
const CARTOONS = "Animation"

const tabMemory = new Map<string, { params: string, scroll: number }>()

export default function Page() {

    const router = useRouter()
    const searchParams = useSearchParams()
    const tab = (searchParams.get("tab") as SeriesTab) || "discover"
    const pendingScroll = React.useRef<number | undefined>(undefined)

    const setTab = (t: SeriesTab) => {
        if (t === tab) return
        const current = new URLSearchParams(searchParams)
        current.delete("tab")
        tabMemory.set(tab, { params: current.toString(), scroll: window.scrollY })
        const saved = tabMemory.get(t)
        const params = new URLSearchParams(saved?.params ?? "")
        if (t !== "discover") params.set("tab", t)
        pendingScroll.current = saved?.scroll ?? 0
        router.push(`/series?${params.toString()}`, { scroll: false })
    }

    React.useEffect(() => {
        const target = pendingScroll.current
        if (target === undefined) return
        pendingScroll.current = undefined
        const started = Date.now()
        const timer = window.setInterval(() => {
            window.scrollTo({ top: target, behavior: "auto" })
            if ((Math.abs(window.scrollY - target) < 2 && Date.now() - started > 400) || Date.now() - started > 2000) window.clearInterval(timer)
        }, 50)
        return () => window.clearInterval(timer)
    }, [tab])

    const [heroItems, setHeroItems] = React.useState<Movie_Meta[]>()
    const hidden = useHiddenMovies()

    return (
        <>
            <MoviesPageHeader items={React.useMemo(() => heroItems?.filter(m => !hidden.has(m.id)), [heroItems, hidden])} />
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.6 }}
                className="p-4 sm:p-8 space-y-10 pb-10 relative z-[4]"
                data-series-page-container
            >
                <div className="lg:absolute w-full lg:-top-10 left-0 flex gap-4 p-4 items-center justify-center flex-wrap" data-series-page-header-tabs-container>
                    <div className="max-w-fit border rounded-full overflow-hidden">
                        <StaticTabs
                            className="h-full py-0"
                            triggerClass="px-4 py-2 h-full rounded-full border-transparent"
                            pillClass="rounded-full border-transparent"
                            items={[
                                { name: "Series", isCurrent: tab === "discover", onClick: () => setTab("discover") },
                                { name: "Browse", isCurrent: tab === "browse", onClick: () => setTab("browse") },
                                { name: "My List", isCurrent: tab === "list", onClick: () => setTab("list") },
                                { name: "Library", isCurrent: tab === "library", onClick: () => setTab("library") },
                                { name: "Downloads", isCurrent: tab === "downloads", onClick: () => setTab("downloads") },
                            ]}
                        />
                    </div>
                </div>

                <AnimatePresence mode="wait" initial={false}>
                    {tab === "discover" && <PageWrapper key="discover" className="relative pb-10 pt-4 space-y-8" {...TAB_TRANSITION}>
                        <Row title="Trending Right Now"><MovieCarousel catalog={{ type: "series", catalog: "top" }} withGenreSelector genreParam="trending"
                                                                       onData={setHeroItems} /></Row>
                        <Row title={`New in ${CURRENT_YEAR}`}><MovieCarousel catalog={{ type: "series", catalog: "year", genre: String(CURRENT_YEAR) }} lazy /></Row>
                        <Row title="Cartoons"><MovieCarousel catalog={{ type: "series", catalog: "top", genre: CARTOONS }} lazy /></Row>
                        <Row title="Drama"><MovieCarousel catalog={{ type: "series", catalog: "top", genre: "Drama" }} lazy /></Row>
                        <Row title="Popular Asian Dramas"><MovieCarousel catalog={{ type: "series" }} dramas={{ order: 1 }} lazy /></Row>
                        <Row title="Korean Dramas"><MovieCarousel catalog={{ type: "series" }} dramas={{ country: 2, order: 1 }} lazy /></Row>
                        <Row title="Comedy"><MovieCarousel catalog={{ type: "series", catalog: "top", genre: "Comedy" }} lazy /></Row>
                        <Row title="Crime"><MovieCarousel catalog={{ type: "series", catalog: "top", genre: "Crime" }} lazy /></Row>
                        <Row title="Sci-Fi & Fantasy"><MovieCarousel catalog={{ type: "series", catalog: "top", genre: "Sci-Fi" }} lazy /></Row>
                        <Row title="Chinese Dramas"><MovieCarousel catalog={{ type: "series" }} dramas={{ country: 1, order: 1 }} lazy /></Row>
                        <Row title="Recently Updated Asian Dramas"><MovieCarousel catalog={{ type: "series" }} dramas={{ order: 2 }} lazy /></Row>
                        <Row title="Reality TV"><MovieCarousel catalog={{ type: "series", catalog: "top", genre: "Reality-TV" }} lazy /></Row>
                        <Row title="Last Year's Best"><MovieCarousel catalog={{ type: "series", catalog: "year", genre: String(CURRENT_YEAR - 1) }} lazy /></Row>
                    </PageWrapper>}

                    {tab === "browse" && <PageWrapper key="browse" className="relative pb-10 pt-4 space-y-6" {...TAB_TRANSITION}>
                        <SeriesBrowse />
                    </PageWrapper>}

                    {tab === "list" && <PageWrapper key="list" className="relative pb-10 pt-4 space-y-6" {...TAB_TRANSITION}>
                        <h2>My List</h2>
                        <SeriesMyList />
                    </PageWrapper>}

                    {tab === "library" && <PageWrapper key="library" className="relative pb-10 pt-4 space-y-6 max-w-5xl mx-auto" {...TAB_TRANSITION}>
                        <h2>Library</h2>
                        <SeriesLibrary />
                    </PageWrapper>}

                    {tab === "downloads" && <PageWrapper key="downloads" className="relative pb-10 pt-4 space-y-6 max-w-5xl mx-auto" {...TAB_TRANSITION}>
                        <h2>Downloads</h2>
                        <MovieDownloads filter={t => !!t.folder} empty="No series are downloading. Open a series and press Download." />
                    </PageWrapper>}
                </AnimatePresence>
            </motion.div>
        </>
    )
}

function Row({ title, children }: { title: string, children: React.ReactNode }) {
    return <div className="space-y-2 z-[5] relative">
        <h2>{title}</h2>
        {children}
    </div>
}

function useUrlParams() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const setParams = (change: Record<string, string | undefined>) => {
        const params = new URLSearchParams(searchParams)
        for (const [k, v] of Object.entries(change)) v ? params.set(k, v) : params.delete(k)
        router.replace(`?${params.toString()}`, { scroll: false })
    }
    return { searchParams, setParams }
}

function useSearchBox() {
    const { searchParams, setParams } = useUrlParams()
    const [query, setQuery] = React.useState(searchParams.get("q") ?? "")
    const search = useDebounce(query.trim(), 500)
    React.useEffect(() => {
        if (search !== (searchParams.get("q") ?? "")) setParams({ q: search || undefined })
    }, [search])
    return { query, setQuery, search, searchParams, setParams }
}

function SearchBox({ value, onChange, placeholder }: { value: string, onChange: (v: string) => void, placeholder: string }) {
    return <div className="max-w-2xl mx-auto">
        <TextInput leftIcon={<FiSearch />} placeholder={placeholder} value={value} onValueChange={onChange} className="rounded-full" autoFocus />
    </div>
}

function Results({ items, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage, empty }: {
    items: Movie_Meta[], isLoading: boolean, isError: boolean, hasNextPage?: boolean, isFetchingNextPage?: boolean, fetchNextPage?: () => void,
    empty?: string
}) {
    if (isLoading) return <div className="flex justify-center py-10"><LoadingSpinner /></div>
    if (isError) return <LuffyError title={null}><p>Could not load series, check your connection.</p></LuffyError>
    if (!items.length && empty) return <p className="text-[--muted] text-center py-4">{empty}</p>
    return <>
        <MediaCardGrid>
            {items.map(meta => <MovieEntryCard key={meta.id} meta={meta} />)}
        </MediaCardGrid>
        {hasNextPage && <div className="flex justify-center">
            <Button intent="gray-subtle" className="rounded-full" loading={isFetchingNextPage} onClick={() => fetchNextPage?.()}>
                Load more
            </Button>
        </div>}
    </>
}

const unique = (metas: Movie_Meta[], hidden: Set<string>) => {
    const seen = new Set<string>()
    return metas.filter(m => !hidden.has(m.id) && !seen.has(m.id) && seen.add(m.id))
}

function SeriesBrowse() {
    const hidden = useHiddenMovies()
    const { query, setQuery, search, searchParams, setParams } = useSearchBox()
    const genre = searchParams.get("genre") ?? undefined
    const year = searchParams.get("year") ?? undefined

    const isDrama = genre === ASIAN_DRAMA_GENRE
    const setGenre = (g: string | undefined) => {
        if ((g === ASIAN_DRAMA_GENRE) === isDrama) return setParams({ genre: g })
        // The drama page has its own search and filters, so neither carries over
        setQuery("")
        setParams({ genre: g, q: undefined, year: undefined, country: undefined, order: undefined, type: undefined, status: undefined, tag: undefined })
    }

    const catalog = useBrowseCatalog("series", genre, year, search, !isDrama)
    const items = React.useMemo(() => unique(catalog.metas, hidden), [catalog.metas, hidden])

    const genres = <MediaGenreSelector
        items={[
            { name: "All", isCurrent: !genre, onClick: () => setGenre(undefined) },
            { name: "Cartoons", isCurrent: genre === CARTOONS, onClick: () => setGenre(CARTOONS) },
            ...SERIES_GENRES_WITH_DRAMAS.filter(g => g !== CARTOONS).map(g => ({ name: g, isCurrent: genre === g, onClick: () => setGenre(g) })),
        ]}
    />

    // Asian Drama opens its own search page, with kisskh's countries and sorting
    if (isDrama) return <>
        {genres}
        <DramaSearch />
    </>

    return (
        <>
            <SearchBox value={query} onChange={setQuery} placeholder="Search series and cartoons…" />

            <div className="w-40 mx-auto" data-browse-year>
                <Select
                    options={[{ value: "0", label: "Any year" }, ...browseYears("series").map(y => ({ value: y, label: y }))]}
                    value={year ?? "0"}
                    onValueChange={v => setParams({ year: v !== "0" ? v : undefined })}
                />
            </div>

            {!search && genres}

            {search ? <SearchSections items={items} isLoading={catalog.isLoading} isError={catalog.isError} />
                : <Results
                    items={items}
                    isLoading={catalog.isLoading}
                    isError={catalog.isError}
                    hasNextPage={catalog.hasNextPage}
                    isFetchingNextPage={catalog.isFetchingNextPage}
                    fetchNextPage={catalog.fetchNextPage}
                />}
        </>
    )
}

/** Search results split into series and cartoons. Search results carry no genres, so each one's details are loaded. */
function SearchSections({ items, isLoading, isError }: { items: Movie_Meta[], isLoading: boolean, isError: boolean }) {
    const metas = useQueries({
        queries: items.map(m => ({
            queryKey: ["movies-meta", m.id, "series"],
            queryFn: () => fetchMovieMeta(m.id, "series"),
            staleTime: 1000 * 60 * 60,
        })),
    })
    const loading = isLoading || metas.some(q => q.isLoading)
    const full = items.map((m, i) => metas[i]?.data ?? m)
    const isCartoon = (m: Movie_Meta) => (m.genres ?? m.genre ?? []).includes(CARTOONS)
    const cartoons = full.filter(isCartoon)
    const series = full.filter(m => !isCartoon(m))

    if (loading || isError) return <Results items={[]} isLoading={loading} isError={isError} />
    if (!full.length) return <LuffyError title={null}><p>Nothing found.</p></LuffyError>
    return <>
        <div className="space-y-4" data-series-search-series>
            <h2>Series</h2>
            <Results items={series} isLoading={false} isError={false} empty="No series match this search." />
        </div>
        <div className="space-y-4" data-series-search-cartoons>
            <h2>Cartoons</h2>
            <Results items={cartoons} isLoading={false} isError={false} empty="No cartoons match this search." />
        </div>
    </>
}

const DRAMA_SORTING = [{ value: "1", label: "Popular" }, { value: "2", label: "Recently updated" }, { value: "3", label: "Newest" }]
const DRAMA_TYPES = [{ value: "1", label: "TV series" }, { value: "2", label: "Movies" }]
const DRAMA_STATUS = [{ value: "0", label: "Any status" }, { value: "1", label: "Ongoing" }, { value: "2", label: "Completed" }]
// kisskh has no genres, so these are Dramaday's tags (its Korean titles, matched to kisskh)
const DRAMA_GENRES = [
    ["Romance", 7], ["Comedy", 8], ["Thriller", 80], ["Mystery", 79], ["Action", 45], ["Fantasy", 13], ["Crime", 106],
    ["Melodrama", 18], ["Historical", 29], ["Youth", 159], ["Family", 265], ["Horror", 421], ["BL", 745], ["Legal", 84],
    ["Supernatural", 293], ["Medical", 48], ["School", 120], ["Sci-fi", 139], ["Political", 44], ["Music", 160], ["Office", 75],
] as const

/** Laid out like the anime search page: options on the left, results on the right */
function DramaSearch() {
    const hidden = useHiddenMovies()
    const { searchParams, setParams } = useUrlParams()
    const [query, setQuery] = React.useState(searchParams.get("q") ?? "")
    const search = useDebounce(query.trim(), 500)
    React.useEffect(() => {
        if (search !== (searchParams.get("q") ?? "")) setParams({ q: search || undefined })
    }, [search])
    const country = Number(searchParams.get("country") ?? 0) || 0
    const order = Number(searchParams.get("order") ?? 1) || 1
    const type = Number(searchParams.get("type") ?? 1) || 1
    const status = Number(searchParams.get("status") ?? 0) || 0
    const tag = Number(searchParams.get("tag") ?? 0) || 0
    const tagName = DRAMA_GENRES.find(g => g[1] === tag)?.[0]

    // kisskh's search only filters by type, the other options apply to the lists. A genre lists Korean titles, newest first
    const catalog = useInfiniteDramaCatalog(search ? { search, type } : tag ? { tag, type } : { country, order, type, status })
    const items = React.useMemo(() => unique(catalog.data?.pages.flat() ?? [], hidden), [catalog.data, hidden])

    const countryName = DRAMA_COUNTRIES.find(c => c.id === country)?.name
    const what = type === 2 ? "movies" : "dramas"
    const title = search ? `Asian ${what} matching "${search}"`
        : tagName ? `${tagName} Korean ${what}`
        : `${DRAMA_SORTING.find(o => o.value === String(order))?.label}${status ? ` ${DRAMA_STATUS[status].label.toLowerCase()}` : ""} ${country ? countryName : "Asian"} ${what}`
    const changed = !!query || !!country || order !== 1 || type !== 1 || !!status || !!tag

    return (
        <div className="space-y-6" data-drama-search>
            <h2 className="line-clamp-2">{title}</h2>
            <AppLayoutGrid cols={6} spacing="lg">
                <AppLayoutStack className="px-4 xl:px-0 space-y-3" data-drama-search-options>
                    <TextInput leftIcon={<FiSearch />} placeholder="Title" value={query} onValueChange={setQuery} autoFocus />
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-1 gap-4 lg:gap-3">
                        <Select
                            leftAddon={<BiTag className={cn(!!tag && "text-indigo-300 font-bold text-xl")} />}
                            className="w-full"
                            options={[{ value: "0", label: "Any genre" }, ...DRAMA_GENRES.map(([name, id]) => ({ value: String(id), label: name }))]}
                            value={String(tag)}
                            onValueChange={v => setParams({ tag: v !== "0" ? v : undefined })}
                            disabled={!!search}
                        />
                        <Select
                            leftAddon={<BiWorld className={cn(!!country && "text-indigo-300 font-bold text-xl")} />}
                            className="w-full"
                            options={DRAMA_COUNTRIES.map(c => ({ value: String(c.id), label: c.id ? c.name : "All countries" }))}
                            value={String(country)}
                            onValueChange={v => setParams({ country: v !== "0" ? v : undefined })}
                            disabled={!!search || !!tag}
                        />
                        <Select
                            leftAddon={<BiTv className={cn(type !== 1 && "text-indigo-300 font-bold text-xl")} />}
                            className="w-full"
                            options={DRAMA_TYPES}
                            value={String(type)}
                            onValueChange={v => setParams({ type: v !== "1" ? v : undefined })}
                        />
                        <Select
                            leftAddon={<BiCalendarCheck className={cn(!!status && "text-indigo-300 font-bold text-xl")} />}
                            className="w-full"
                            options={DRAMA_STATUS}
                            value={String(status)}
                            onValueChange={v => setParams({ status: v !== "0" ? v : undefined })}
                            disabled={!!search || !!tag}
                        />
                        <Select
                            leftAddon={<FaSortAmountDown className={cn(order !== 1 && "text-indigo-300 font-bold text-xl")} />}
                            className="w-full"
                            options={DRAMA_SORTING}
                            value={String(order)}
                            onValueChange={v => setParams({ order: v !== "1" ? v : undefined })}
                            disabled={!!search || !!tag}
                        />
                        <IconButton
                            icon={<BiTrash />} intent={changed ? "alert" : "gray-subtle"} className="flex-none"
                            onClick={() => {
                                setQuery("")
                                setParams({ q: undefined, country: undefined, order: undefined, type: undefined, status: undefined, tag: undefined })
                            }}
                        />
                    </div>
                </AppLayoutStack>
                <div className="col-span-5" data-drama-search-list>
                    <Results
                        items={items}
                        isLoading={catalog.isLoading}
                        isError={catalog.isError}
                        hasNextPage={catalog.hasNextPage}
                        isFetchingNextPage={catalog.isFetchingNextPage}
                        fetchNextPage={catalog.fetchNextPage}
                        empty="Nothing found."
                    />
                </div>
            </AppLayoutGrid>
        </div>
    )
}

function SeriesMyList() {
    const { data, isLoading, isError } = useMovieList()

    const items = React.useMemo(() => {
        const seen = new Set<string>()
        return (data ?? []).flatMap(item => {
            const meta = listItemMeta(item)
            if (!meta || meta.type !== "series" || seen.has(meta.id)) return []
            seen.add(meta.id)
            return [meta]
        }).reverse()
    }, [data])

    if (isLoading) return <div className="flex justify-center py-10"><LoadingSpinner /></div>
    if (isError) return <LuffyError title="Media helper unavailable">
        <p>Restart Seanime to load your list.</p>
    </LuffyError>
    if (!items.length) return <LuffyError title={null}>
        <p>Your list is empty. Use the bookmark button on a series to save it here.</p>
    </LuffyError>

    return <MediaCardGrid>
        {items.map(meta => <MovieEntryCard key={meta.id} meta={meta} showTrailer={false} hideable={false} />)}
    </MediaCardGrid>
}
