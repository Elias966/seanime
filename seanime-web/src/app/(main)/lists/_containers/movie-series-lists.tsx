import { MediaCardGrid } from "@/app/(main)/_features/media/_components/media-card-grid"
import { MovieEntryCard } from "@/app/(main)/movies/_components/movie-entry-card"
import { listItemMeta, Movie_Meta, playLibraryItem, useMovieLibrary, useMovieList } from "@/app/(main)/movies/_lib/movies.api"
import { LuffyError } from "@/components/shared/luffy-error"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Switch } from "@/components/ui/switch"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { toast } from "sonner"

const downloadedOnlyAtom = atom(false)

/** The movies and series saved with the bookmark button, and the movies downloaded to the movie library. */
export function MovieSeriesLists() {
    const { data: list, isLoading, isError } = useMovieList()
    const { data: library } = useMovieLibrary()
    const [downloadedOnly, setDownloadedOnly] = useAtom(downloadedOnlyAtom)

    const { movies, series } = React.useMemo(() => {
        const seen = new Set<string>()
        const saved = (list ?? []).flatMap(item => {
            const meta = listItemMeta(item)
            if (!meta || seen.has(meta.id)) return []
            seen.add(meta.id)
            return [meta]
        }).reverse()
        return { movies: saved.filter(m => m.type === "movie"), series: saved.filter(m => m.type === "series") }
    }, [list])

    // Downloaded only: every movie in the movie library, the saved ones first
    const downloaded = React.useMemo(() => {
        const items = library ?? []
        const rank = (imdb: string) => {
            const i = movies.findIndex(m => m.id === imdb)
            return i < 0 ? movies.length : i
        }
        return [...items].sort((a, b) => rank(a.imdb) - rank(b.imdb) || b.added - a.added)
    }, [library, movies])

    if (isLoading) return <div className="flex justify-center py-10"><LoadingSpinner /></div>

    return (
        <div className="space-y-6" data-my-list-movies-series>
            <div className="flex justify-center">
                <Switch
                    label="Downloaded movies only"
                    value={downloadedOnly}
                    onValueChange={setDownloadedOnly}
                    fieldClass="w-fit flex-none"
                    data-my-list-downloaded-only
                />
            </div>

            {isError && <LuffyError title="Media helper unavailable"><p>Restart Seanime to load your list.</p></LuffyError>}

            {downloadedOnly ? <section className="space-y-6" data-my-list-downloaded>
                <h2>Downloaded movies <span className="text-[--muted] font-medium ml-3">{downloaded.length}</span></h2>
                {!downloaded.length ? <p className="text-[--muted]">No downloaded movies yet.</p> : <MediaCardGrid>
                    {downloaded.map(item => {
                        const meta: Movie_Meta = {
                            id: item.imdb,
                            type: "movie",
                            name: item.title,
                            poster: item.poster || `https://images.metahub.space/poster/medium/${item.imdb}/img`,
                            background: item.background,
                            year: item.year,
                        }
                        return <MovieEntryCard
                            key={item.hash}
                            meta={meta}
                            showTrailer={false}
                            hideable={false}
                            onWatch={() => playLibraryItem(item).catch((e: any) => toast.error(e?.message ?? String(e)))}
                        />
                    })}
                </MediaCardGrid>}
            </section> : <>
                <section className="space-y-6" data-my-list-movies>
                    <h2>Movies <span className="text-[--muted] font-medium ml-3">{movies.length}</span></h2>
                    {!movies.length ? <p className="text-[--muted]">No movies saved. Use the bookmark button on a movie to add it here.</p> : <MediaCardGrid>
                        {movies.map(meta => <MovieEntryCard key={meta.id} meta={meta} showTrailer={false} hideable={false} />)}
                    </MediaCardGrid>}
                </section>
                <section className="space-y-6" data-my-list-series>
                    <h2>Series <span className="text-[--muted] font-medium ml-3">{series.length}</span></h2>
                    {!series.length ? <p className="text-[--muted]">No series saved. Use the bookmark button on a series to add it here.</p> : <MediaCardGrid>
                        {series.map(meta => <MovieEntryCard key={meta.id} meta={meta} showTrailer={false} hideable={false} />)}
                    </MediaCardGrid>}
                </section>
            </>}
        </div>
    )
}
