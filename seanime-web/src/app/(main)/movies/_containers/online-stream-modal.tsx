import { captureMovieStream, Movie_StreamRef, Movie_StreamServers, Movie_StreamSource, playCapturedStream } from "@/app/(main)/movies/_lib/movies.api"
import { cn } from "@/components/ui/core/styling"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { ProgressBar } from "@/components/ui/progress-bar"
import React from "react"

export const MOVIE_LAST_SOURCE_KEY = "seanime-movies-last-stream-source"

export function readLastSource(key = MOVIE_LAST_SOURCE_KEY) {
    try {
        return localStorage.getItem(key) ?? undefined
    }
    catch {
        return undefined
    }
}

/** Plays one website's video, returning why it failed or undefined once it plays. */
async function streamFromSource(source: Movie_StreamSource, ref: Movie_StreamRef, signal: AbortSignal, onStarting: () => void,
    onServers: (servers: Movie_StreamServers) => void) {
    try {
        const found = source.resolve && await source.resolve(ref, signal)
        if (source.resolve && !found) return signal.aborted ? "skipped" : `${source.name} can't find this title`
        const stream = await captureMovieStream(found ? { ...source, url: () => found } : source, ref, signal, onServers)
        if (signal.aborted) return
        onStarting()
        // OpenSubtitles finds a series episode by "tt…:season:episode"
        const subtitleId = ref.imdb && ref.season !== undefined ? `${ref.imdb}:${ref.season}:${ref.episode}` : ref.imdb
        await playCapturedStream(stream, ref.title, signal, subtitleId)
        return undefined
    }
    catch (e: any) {
        return String(e?.message ?? e)
    }
}

/** Tries the websites one after another until one of them returns a video, then hands it to the native player. */
export function OnlineStreamModal({ streaming, ref_, onClose, onTryAll, lastSourceKey = MOVIE_LAST_SOURCE_KEY }: {
    streaming?: { sources: Movie_StreamSource[], key: number },
    ref_: Movie_StreamRef,
    onClose: () => void,
    onTryAll: () => void,
    /** Where the website that played is remembered, so Play tries it first next time */
    lastSourceKey?: string
}) {
    const [current, setCurrent] = React.useState<Movie_StreamSource>()
    const [failed, setFailed] = React.useState<{ name: string, error: string }[]>([])
    const [error, setError] = React.useState<string>()
    const [starting, setStarting] = React.useState(false)
    // The current website's servers for this episode or movie, switchable while it looks for the video
    const [servers, setServers] = React.useState<Movie_StreamServers>()
    const skipRef = React.useRef<(() => void) | undefined>(undefined)

    React.useEffect(() => {
        setCurrent(undefined)
        setStarting(false)
        setServers(undefined)
        setFailed([])
        setError(undefined)
        if (!streaming) return
        const controller = new AbortController()

        ;(async () => {
            for (const source of streaming.sources) {
                if (controller.signal.aborted) return
                setCurrent(source)
                setServers(undefined)
                // Skip only cancels this website, closing the modal cancels everything
                const attempt = new AbortController()
                const cancel = () => attempt.abort()
                controller.signal.addEventListener("abort", cancel)
                skipRef.current = cancel
                const message = await streamFromSource(source, ref_, attempt.signal, () => setStarting(true), setServers)
                controller.signal.removeEventListener("abort", cancel)
                skipRef.current = undefined
                if (controller.signal.aborted) return
                if (!attempt.signal.aborted && !message) {
                    try {
                        localStorage.setItem(lastSourceKey, source.id)
                    }
                    catch {
                    }
                    onClose()
                    return
                }
                setStarting(false)
                setServers(undefined)
                const reason = attempt.signal.aborted ? "skipped" : message!
                const line = { name: source.name, error: reason.startsWith(source.name) ? reason : `${source.name}: ${reason}` }
                setFailed(f => [...f, line])
            }
            setCurrent(undefined)
            setError(streaming.sources.length > 1 ? "None of the websites returned a video. Try again later or use a torrent."
                : "This website did not return a video. Try another one.")
        })()
        return () => controller.abort()
    }, [streaming?.key])

    return (
        <Modal
            open={!!streaming}
            onOpenChange={v => !v && onClose()}
            title="Preparing stream"
            contentClass="max-w-xl"
        >
            <div className="space-y-4" data-movie-online-stream-modal>
                <p className="font-medium line-clamp-2">{ref_.title}</p>
                {error ? <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-red-300 flex-1">{error}</p>
                    {streaming?.sources.length === 1 && <Button size="sm" intent="white" className="rounded-full" onClick={onTryAll}>
                        Try all websites
                    </Button>}
                </div> : <>
                    <ProgressBar isIndeterminate size="sm" />
                    <div className="flex items-center gap-3">
                        <p className="text-sm text-[--muted] flex-1">
                            {!current ? "Starting…" : starting ? `Starting playback from ${current.name}…` : `Looking for the video on ${current.name}…`}
                        </p>
                        {!!current && !starting && (streaming?.sources.length ?? 0) > 1 && current !== streaming?.sources.at(-1) && <Button
                            size="sm"
                            intent="gray-subtle"
                            className="rounded-full"
                            onClick={() => skipRef.current?.()}
                            data-movie-online-stream-skip
                        >
                            Next website
                        </Button>}
                    </div>
                    {!!current && !starting && !!servers && servers.labels.length > 1 && <div className="space-y-2" data-movie-online-stream-servers>
                        <p className="text-xs text-[--muted]">
                            Servers on {current.name}. Dead ones are skipped, or pick one to use it (remembered for this website).
                        </p>
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                            {servers.labels.map((label, i) => <button
                                key={i}
                                type="button"
                                className={cn("px-2.5 py-1 rounded-full text-xs border transition-colors",
                                    i === servers.active ? "bg-white text-black border-white" : "border-[--border] hover:bg-gray-800")}
                                onClick={() => {
                                    servers.pick(i)
                                    setServers({ ...servers, active: i })
                                }}
                                data-movie-online-stream-server={i}
                            >
                                {label}
                            </button>)}
                        </div>
                    </div>}
                </>}
                {!!failed.length && <div className="space-y-1">
                    {failed.map((f, i) => <p key={i} className="text-xs text-[--muted]">✕ {f.error}</p>)}
                </div>}
            </div>
        </Modal>
    )
}
