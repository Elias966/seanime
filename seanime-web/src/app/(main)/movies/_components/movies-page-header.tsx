import { ElectronYoutubeEmbed } from "@/app/(main)/_electron/electron-embed"
import { TRANSPARENT_SIDEBAR_BANNER_IMG_STYLE } from "@/app/(main)/_features/custom-ui/styles"
import { MediaEntryAudienceScore } from "@/app/(main)/_features/media/_components/media-entry-metadata-components"
import { imdbToScore, MovieListButton } from "@/app/(main)/movies/_components/movie-entry-card"
import { Movie_Meta, movieBackground, movieLink, moviePoster, movieTrailerId, movieYear } from "@/app/(main)/movies/_lib/movies.api"
import { imageShimmer } from "@/components/shared/image-helpers"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaLink } from "@/components/shared/sea-link"
import { TextGenerateEffect } from "@/components/shared/text-generate-effect"
import { Button } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useRouter } from "@/lib/navigation"
import { ThemeMediaPageBannerSize, useThemeSettings } from "@/lib/theme/theme-hooks"
import { __isDesktop__, __isElectronDesktop__ } from "@/types/constants"
import { AnimatePresence, motion } from "motion/react"
import React from "react"
import { BiPlay } from "react-icons/bi"

const MotionImage = motion.create(SeaImage)
const MotionIframe = motion.create("iframe")

const MAX_ITEMS = 12

/**
 * Rotating hero of the Movies page, same look and behavior as the anime Discover header:
 * rotates every 12s, pauses on hover and plays the trailer after hovering for a second.
 */
export function MoviesPageHeader({ items }: { items: Movie_Meta[] | undefined }) {
    const ts = useThemeSettings()

    const slides = React.useMemo(() => (items ?? []).filter(m => !!m.background || !!m.poster).slice(0, MAX_ITEMS), [items])

    const [index, setIndex] = React.useState(0)
    const [isTransitioning, setIsTransitioning] = React.useState(false)
    const [isHoveringHeader, setHoveringHeader] = React.useState(false)
    const [clickedDot, setClickedDot] = React.useState(0)

    const [showTrailer, setShowTrailer] = React.useState(false)
    const [trailerLoaded, setTrailerLoaded] = React.useState(false)

    const current = slides[index] ?? slides[0]
    const trailerId = movieTrailerId(current)

    const slideCount = React.useRef(0)
    slideCount.current = slides.length

    const goTo = React.useCallback((next: number | "next") => {
        setIsTransitioning(true)
        setTimeout(() => {
            setIndex(p => next === "next" ? (p + 1) % Math.max(1, slideCount.current) : next)
            setIsTransitioning(false)
        }, 900)
    }, [])

    React.useEffect(() => {
        if (isHoveringHeader || slides.length <= 1) return
        const t = setInterval(() => goTo("next"), 12000)
        return () => clearInterval(t)
    }, [isHoveringHeader, clickedDot, slides.length])

    React.useEffect(() => {
        setShowTrailer(false)
        setTrailerLoaded(false)
        if (!isHoveringHeader || isTransitioning || !trailerId) return
        const t = setTimeout(() => setShowTrailer(true), 1000)
        return () => clearTimeout(t)
    }, [isHoveringHeader, isTransitioning, trailerId])

    const bannerClass = cn(
        "lg:h-[35rem] w-full flex-none object-cover object-center absolute top-0 bg-[--background]",
        !ts.disableSidebarTransparency && TRANSPARENT_SIDEBAR_BANNER_IMG_STYLE,
        __isDesktop__ && "top-[-2rem]",
        ts.mediaPageBannerSize === ThemeMediaPageBannerSize.Small && "lg:h-[30rem]",
    )

    if (!current) return <div>
        <Skeleton className={bannerClass} />
    </div>

    return (
        <motion.div
            data-movies-page-header
            className={cn(
                "__header lg:h-[28rem] overflow-hidden",
                ts.hideTopNavbar && "lg:h-[32rem]",
                ts.mediaPageBannerSize === ThemeMediaPageBannerSize.Small && "lg:h-[24rem]",
                (ts.mediaPageBannerSize === ThemeMediaPageBannerSize.Small && ts.hideTopNavbar) && "lg:h-[28rem]",
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2 }}
        >
            {/* Banner */}
            <div data-movies-page-header-banner-image className={bannerClass}>
                <div className="w-full z-[2] absolute bottom-[-10rem] h-[10rem] bg-gradient-to-b from-[--background] via-transparent via-100% to-transparent" />
                <div className="w-full absolute z-[2] top-0 h-[10rem] opacity-50 bg-gradient-to-b from-[--background] to-transparent" />
                <div
                    className={cn(
                        "opacity-0 duration-1000 bg-[var(--background)] w-full h-full absolute z-[2]",
                        isTransitioning && "opacity-70",
                    )}
                />

                <div className="w-full h-full absolute z-[1] overflow-hidden">
                    <MotionImage
                        key={current.id}
                        src={movieBackground(current)}
                        alt="banner image"
                        fill
                        quality={100}
                        priority
                        className={cn(
                            "object-cover object-center z-[1] transition-all duration-1000",
                            isTransitioning ? "scale-[1.01] -translate-x-0.5" : "scale-100 translate-x-0",
                            trailerLoaded && "opacity-0",
                        )}
                    />
                </div>

                {(showTrailer && trailerId) && (
                    <div className={cn("absolute w-full h-full overflow-hidden z-[1]", !trailerLoaded && "opacity-0")}>
                        {__isElectronDesktop__ && <motion.div
                            className="w-full h-full absolute left-0 object-cover object-center lg:scale-[1.8] 2xl:scale-[2.5]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: trailerLoaded ? 1 : 0 }}
                            transition={{ duration: 0.5 }}
                        >
                            <ElectronYoutubeEmbed
                                trailerId={trailerId} isBanner
                                onLoad={() => setTimeout(() => setTrailerLoaded(true), 1000)}
                                onError={() => setShowTrailer(false)}
                            />
                        </motion.div>}
                        {!__isElectronDesktop__ && <MotionIframe
                            {...({ credentialless: "true" } as any)}
                            src={`https://www.youtube-nocookie.com/embed/${trailerId}?autoplay=1&controls=0&mute=1&disablekb=1&loop=1&vq=medium&playlist=${trailerId}&enablejsapi=true`}
                            className="w-full h-full absolute left-0 object-cover object-center lg:scale-[1.8] 2xl:scale-[2.5]"
                            allow="autoplay"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: trailerLoaded ? 1 : 0 }}
                            transition={{ duration: 0.5 }}
                            onLoad={() => setTimeout(() => setTrailerLoaded(true), 1000)}
                            onError={() => setShowTrailer(false)}
                        />}
                    </div>
                )}

                <div
                    className="hidden lg:block max-w-[80rem] w-full z-[2] h-full absolute left-0 bg-gradient-to-r from-[--background] from-20% via-[--background] transition-opacity via-opacity-50 via-5% to-transparent opacity-70 duration-500"
                />
                {!ts.disableSidebarTransparency && <div
                    className="hidden lg:block max-w-[10rem] w-full z-[2] h-full absolute left-0 bg-gradient-to-r from-[--background] via-[--background] transition-opacity via-opacity-50 via-5% to-transparent opacity-70 duration-500"
                />}
                <div className="w-full z-[2] absolute bottom-0 h-[20rem] bg-gradient-to-t from-[--background] via-[--background] via-opacity-50 via-10% to-transparent" />
            </div>

            <div
                className={cn(
                    "absolute left-2 w-fit h-[20rem] bg-gradient-to-t z-[3] hidden lg:block",
                    "top-[5rem]",
                    ts.hideTopNavbar && "top-[4rem]",
                    (__isDesktop__ && ts.mediaPageBannerSize === ThemeMediaPageBannerSize.Small) && "top-[0rem]",
                    (__isDesktop__ && ts.mediaPageBannerSize !== ThemeMediaPageBannerSize.Small) && "top-[2rem]",
                )}
                data-movie-id={current.id}
            >
                {slides.length > 1 && <div className="hidden lg:flex items-center gap-2 z-[10] pl-8 max-w-[20rem] flex-wrap top-[4.5rem]">
                    {slides.map((_, i) => (
                        <button
                            key={i}
                            className={cn(
                                "h-1.5 rounded-sm transition-all duration-300 cursor-pointer",
                                i === index ? "w-6 bg-[--muted]" : "w-3 bg-[--subtle] hover:bg-gray-300",
                            )}
                            onClick={() => {
                                if (i !== index) goTo(i)
                                setClickedDot(n => n + 1)
                            }}
                            aria-label={`Go to slide ${i + 1}`}
                        />
                    ))}
                </div>}

                <AnimatePresence>
                    {!isTransitioning && <MovieHeaderMetadata
                        key={current.id}
                        meta={current}
                        isTransitioning={isTransitioning}
                        onHoverChange={setHoveringHeader}
                    />}
                </AnimatePresence>
            </div>
        </motion.div>
    )
}

function MovieHeaderMetadata({ meta, isTransitioning, onHoverChange }: {
    meta: Movie_Meta
    isTransitioning: boolean
    onHoverChange: (hovering: boolean) => void
}) {
    const router = useRouter()
    const link = movieLink(meta.id, meta.type)
    const genres = meta.genres ?? meta.genre ?? []
    const year = movieYear(meta)

    return (
        <motion.div
            className="flex items-center relative gap-6 p-6 pr-3 w-fit overflow-hidden"
            onMouseEnter={() => onHoverChange(true)}
            onMouseLeave={() => onHoverChange(false)}
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ type: "spring", damping: 20, stiffness: 100 }}
        >
            <motion.div
                className="flex-none"
                initial={{ opacity: 0, scale: 0.7, skew: 5 } as any}
                animate={{ opacity: 1, scale: 1, skew: 0 } as any}
                exit={{ opacity: 1, scale: 1, skewY: 1 }}
                transition={{ duration: 0.5 }}
            >
                <SeaLink href={link}>
                    <div className="w-[180px] h-[280px] relative rounded-[--radius-md] overflow-hidden bg-[--background] shadow-md">
                        <SeaImage
                            src={moviePoster(meta.poster, "large")}
                            alt="cover image"
                            fill
                            priority
                            placeholder={imageShimmer(700, 475)}
                            className={cn(
                                "object-cover object-center transition-opacity duration-1000",
                                isTransitioning ? "opacity-30" : "opacity-100",
                            )}
                        />
                    </div>
                </SeaLink>
            </motion.div>

            <motion.div
                className="flex-auto space-y-2 z-[1]"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.6 }}
            >
                <SeaLink href={link}>
                    <TextGenerateEffect
                        className="[text-shadow:_0_1px_10px_rgb(0_0_0_/_20%)] text-white leading-8 line-clamp-2 pb-1 max-w-md text-pretty text-3xl overflow-ellipsis"
                        words={meta.name}
                    />
                </SeaLink>

                <div className="flex flex-wrap gap-2">
                    {genres.slice(0, 3).map(genre => (
                        <div key={genre} className="text-sm font-semibold px-1 text-gray-300">
                            {genre}
                        </div>
                    ))}
                </div>

                <div className="flex items-center max-w-lg gap-4">
                    {!!imdbToScore(meta.imdbRating) && <div className="rounded-full w-fit inline-block">
                        <MediaEntryAudienceScore meanScore={imdbToScore(meta.imdbRating)} />
                    </div>}
                    {!!year && <p className="text-base font-medium">{year}</p>}
                    {!!meta.runtime && <p className="text-base font-medium text-[--muted]">{meta.runtime}</p>}
                </div>

                <motion.div
                    className="pt-0 left-0"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: 0.7 }}
                >
                    <ScrollArea className="max-w-lg leading-3 h-[77px] mb-4 p-0 text-sm">
                        {meta.description}
                    </ScrollArea>

                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            intent="white"
                            className="rounded-full"
                            leftIcon={<BiPlay className="text-xl" />}
                            onClick={() => router.push(link)}
                        >
                            Watch
                        </Button>
                        <MovieListButton meta={meta} />
                    </div>
                </motion.div>
            </motion.div>
        </motion.div>
    )
}
