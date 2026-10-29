import {
    __mediaEntryCard_hoveredPopupId,
    MediaEntryCardBody,
    MediaEntryCardContainer,
    MediaEntryCardHoverPopup,
    MediaEntryCardHoverPopupBanner,
    MediaEntryCardHoverPopupBody,
    MediaEntryCardHoverPopupFooter,
    MediaEntryCardHoverPopupTitleSection,
    MediaEntryCardTitleSection,
} from "@/app/(main)/_features/media/_components/media-entry-card-components"
import { MediaEntryAudienceScore } from "@/app/(main)/_features/media/_components/media-entry-metadata-components"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import {
    metaToListItem,
    Movie_Meta,
    movieBackground,
    movieLink,
    movieNumericId,
    moviePoster,
    movieTrailerId,
    movieYear,
    useMovieList,
    useSaveMovieToList,
} from "@/app/(main)/movies/_lib/movies.api"
import { Button, IconButton } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useRouter } from "@/lib/navigation"
import { useSetAtom } from "jotai/react"
import React, { useState } from "react"
import { BiPlay } from "react-icons/bi"
import { LuBookmark, LuBookmarkCheck } from "react-icons/lu"

type MovieEntryCardProps = {
    meta: Movie_Meta
    containerClassName?: string
    showTrailer?: boolean
    /** Replaces the Watch button's default (opening the movie page), e.g. to play a downloaded file */
    onWatch?: () => void
}

export function MovieEntryCard(props: MovieEntryCardProps) {

    const {
        meta,
        containerClassName,
        showTrailer = true,
        onWatch,
    } = props

    const router = useRouter()
    const serverStatus = useServerStatus()
    const setActionPopupHover = useSetAtom(__mediaEntryCard_hoveredPopupId)

    const numericId = React.useMemo(() => movieNumericId(meta.id), [meta.id])
    const link = movieLink(meta.id)
    const year = movieYear(meta)
    const genres = meta.genres ?? meta.genre ?? []

    const [shouldRenderPopup, setShouldRenderPopup] = useState(false)
    const closePopupTimerRef = React.useRef<number | undefined>(undefined)

    const handleCardMouseEnter = React.useCallback(() => {
        if (closePopupTimerRef.current) {
            window.clearTimeout(closePopupTimerRef.current)
            closePopupTimerRef.current = undefined
        }
        setShouldRenderPopup(true)
    }, [])

    const handleCardMouseLeave = React.useCallback(() => {
        if (closePopupTimerRef.current) {
            window.clearTimeout(closePopupTimerRef.current)
        }
        closePopupTimerRef.current = window.setTimeout(() => {
            setShouldRenderPopup(false)
            closePopupTimerRef.current = undefined
        }, 35)
    }, [])

    React.useEffect(() => {
        return () => {
            if (closePopupTimerRef.current) {
                window.clearTimeout(closePopupTimerRef.current)
            }
        }
    }, [])

    return (
        <MediaEntryCardContainer
            data-movie-id={meta.id}
            data-media-type="movie"
            className={containerClassName}
            onPointerEnter={handleCardMouseEnter}
            onPointerLeave={handleCardMouseLeave}
        >

            {/*ACTION POPUP*/}
            <MediaEntryCardHoverPopup
                onMouseEnter={() => setActionPopupHover(numericId)}
                onMouseLeave={() => setActionPopupHover(undefined)}
                coverImage={movieBackground(meta) || moviePoster(meta.poster)}
                shouldRenderPopup={shouldRenderPopup}
            >
                <MediaEntryCardHoverPopupBody>

                    <MediaEntryCardHoverPopupBanner
                        trailerId={movieTrailerId(meta)}
                        showProgressBar={false}
                        mediaId={numericId}
                        showTrailer={showTrailer}
                        disableAnimeCardTrailers={serverStatus?.settings?.library?.disableAnimeCardTrailers}
                        bannerImage={movieBackground(meta) || moviePoster(meta.poster, "large")}
                        link={link}
                    />

                    <MediaEntryCardHoverPopupTitleSection
                        title={meta.name}
                        year={year}
                        format={meta.runtime || "MOVIE"}
                        link={link}
                    />

                    <div className="py-1 flex items-center justify-center w-full gap-2">
                        <Button
                            leftIcon={<BiPlay className="text-2xl" />}
                            intent="gray-subtle"
                            size="sm"
                            className="w-full"
                            tabIndex={-1}
                            onClick={() => onWatch ? onWatch() : router.push(link)}
                        >
                            {onWatch ? "Play" : "Watch"}
                        </Button>
                    </div>

                    {!!genres.length && <p className="text-center text-xs text-[--muted] w-full line-clamp-1">
                        {genres.slice(0, 3).join(" · ")}
                    </p>}

                </MediaEntryCardHoverPopupBody>

                <MediaEntryCardHoverPopupFooter>
                    <MovieListButton meta={meta} />
                    <MediaEntryAudienceScore meanScore={imdbToScore(meta.imdbRating)} />
                </MediaEntryCardHoverPopupFooter>
            </MediaEntryCardHoverPopup>

            <MediaEntryCardBody
                link={link}
                type="anime"
                title={meta.name}
                bannerImage={moviePoster(meta.poster)}
            />

            <MediaEntryCardTitleSection
                title={meta.name}
                year={year}
                format="MOVIE"
            />

        </MediaEntryCardContainer>
    )
}

export function imdbToScore(rating?: string) {
    const n = parseFloat(rating ?? "")
    return Number.isFinite(n) && n > 0 ? Math.round(n * 10) : undefined
}

export function MovieListButton({ meta, size = "sm" }: { meta: Movie_Meta, size?: "sm" | "md" }) {
    const { data: list } = useMovieList()
    const { mutate, isPending } = useSaveMovieToList()

    const saved = !!list?.some(i => i.id === meta.id || i.imdb === meta.id)
    const item = metaToListItem(meta)

    return (
        <Tooltip
            trigger={<IconButton
                data-movie-list-button
                intent={saved ? "primary-subtle" : "gray-subtle"}
                icon={saved ? <LuBookmarkCheck /> : <LuBookmark />}
                rounded
                size={size}
                loading={isPending}
                onClick={() => mutate({ item, remove: saved })}
            />}
        >
            {saved ? "Remove from My List" : "Add to My List"}
        </Tooltip>
    )
}
