import { MediaEntryCardSkeleton } from "@/app/(main)/_features/media/_components/media-entry-card-skeleton"
import { MediaGenreSelector } from "@/app/(main)/_features/media/_components/media-genre-selector"
import { MovieEntryCard } from "@/app/(main)/movies/_components/movie-entry-card"
import { MOVIE_GENRES, Movie_Meta, MovieCatalog, useMovieCatalog } from "@/app/(main)/movies/_lib/movies.api"
import { LuffyError } from "@/components/shared/luffy-error"
import { Carousel, CarouselContent, CarouselDotButtons } from "@/components/ui/carousel"
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
}

export function MovieCarousel(props: MovieCarouselProps) {

    const {
        catalog,
        withGenreSelector,
        excludeId,
        onData,
        lazy,
    } = props

    const ref = React.useRef<HTMLDivElement>(null)
    const isInView = useInView(ref, { once: true, margin: "200px" })

    const [genre, setGenre] = React.useState<string | undefined>(catalog.genre)
    const { data, isLoading, isError } = useMovieCatalog({ ...catalog, genre }, !lazy || isInView)

    const items = React.useMemo(() => (data ?? []).filter(m => m.id !== excludeId), [data, excludeId])

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
                        ...MOVIE_GENRES.map(g => ({ name: g, isCurrent: genre === g, onClick: () => setGenre(g) })),
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
            {isError && <LuffyError title={null}><p>Could not load movies, check your connection.</p></LuffyError>}
        </div>
    )
}
