import { MediaEntryCardSkeleton } from "@/app/(main)/_features/media/_components/media-entry-card-skeleton"
import { MediaGenreSelector } from "@/app/(main)/_features/media/_components/media-genre-selector"
import { MovieEntryCard } from "@/app/(main)/movies/_components/movie-entry-card"
import { MOVIE_GENRES, Movie_Meta, MovieCatalog, SERIES_GENRES, useHiddenMovies, useMovieCatalog } from "@/app/(main)/movies/_lib/movies.api"
import { Drama_Catalog, useDramaCatalog } from "@/app/(main)/movies/_lib/movies.api"
import { LuffyError } from "@/components/shared/luffy-error"
import { Carousel, CarouselContent, CarouselDotButtons } from "@/components/ui/carousel"
import { useRouter, useSearchParams } from "@/lib/navigation"
import { useInView } from "motion/react"
import React from "react"

type MovieCarouselProps = {
    catalog: MovieCatalog
    withGenreSelector?: boolean
    /** Excluded from the row (e.g. the movie being viewed) */
    excludeId?: string
    onData?: (items: Movie_Meta[]) => void
    /** Only fetch once scrolled into view */
    lazy?: boolean
    /** Keeps the chosen genre in this URL parameter, so going back to the page shows the same genre */
    genreParam?: string
    /** Shows kisskh's Asian dramas instead of the Cinemeta catalog */
    dramas?: Drama_Catalog
}

export function MovieCarousel(props: MovieCarouselProps) {

    const {
        catalog,
        withGenreSelector,
        excludeId,
        onData,
        lazy,
        genreParam,
        dramas,
    } = props

    const router = useRouter()
    const searchParams = useSearchParams()
    const hidden = useHiddenMovies()

    const ref = React.useRef<HTMLDivElement>(null)
    const isInView = useInView(ref, { once: true, margin: "200px" })

    const [localGenre, setLocalGenre] = React.useState<string | undefined>(catalog.genre)
    const genre = genreParam ? searchParams.get(genreParam) ?? catalog.genre : localGenre
    const setGenre = (g: string | undefined) => {
        if (!genreParam) return setLocalGenre(g)
        const params = new URLSearchParams(searchParams)
        if (g) params.set(genreParam, g)
        else params.delete(genreParam)
        router.replace(`?${params.toString()}`, { scroll: false })
    }
    const movies = useMovieCatalog({ ...catalog, genre }, !dramas && (!lazy || isInView))
    const asian = useDramaCatalog(dramas ?? {}, !!dramas && (!lazy || isInView))
    const { data, isLoading, isError } = dramas ? asian : movies

    const items = React.useMemo(() => (data ?? []).filter(m => m.id !== excludeId && !hidden.has(m.id)), [data, excludeId, hidden])

    React.useEffect(() => {
        if (data && onData) onData(data)
    }, [data])

    return (
        <div ref={ref}>
            <Carousel
                className="w-full max-w-full"
                gap="xl"
                opts={{
                    align: "start",
                    dragFree: true,
                }}
                autoScroll
            >
                {withGenreSelector && <MediaGenreSelector
                    items={[
                        { name: "All", isCurrent: !genre, onClick: () => setGenre(undefined) },
                        ...(catalog.type === "series" ? SERIES_GENRES : MOVIE_GENRES).map(g => ({ name: g, isCurrent: genre === g, onClick: () => setGenre(g) })),
                    ]}
                />}
                <CarouselDotButtons />
                <CarouselContent className="px-6">
                    {(!isLoading && !!data) ? items.map(meta => (
                        <MovieEntryCard
                            key={meta.id}
                            meta={meta}
                            containerClassName="basis-[200px] md:basis-[250px] mx-2 mt-8 mb-0"
                            showTrailer
                        />
                    )) : !isError && [...Array(10).keys()].map(idx => <MediaEntryCardSkeleton key={idx} />)}
                </CarouselContent>
            </Carousel>
            {isError && <LuffyError title={null}><p>Could not load {catalog.type === "series" ? "series" : "movies"}, check your connection.</p></LuffyError>}
        </div>
    )
}
