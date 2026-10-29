import {
    engineAction,
    formatBytes,
    largestPlayableFile,
    Movie_EngineTorrent,
    playEngineFile,
    useEngineTorrents,
} from "@/app/(main)/movies/_lib/movies.api"
import { LuffyError } from "@/components/shared/luffy-error"
import { Badge } from "@/components/ui/badge"
import { Button, IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { ProgressBar } from "@/components/ui/progress-bar"
import { Tooltip } from "@/components/ui/tooltip"
import React from "react"
import { BiPlay, BiStop } from "react-icons/bi"
import { LuDownload, LuRefreshCw } from "react-icons/lu"
import { toast } from "sonner"

/** Torrents running in the local engine (streams and downloads). */
export function MovieDownloads({ filter }: { filter?: (t: Movie_EngineTorrent) => boolean }) {
    const { data, isError, refetch } = useEngineTorrents(2000)

    // The engine only resumes saved transfers once Downloads is opened, so launching Seanime never starts traffic on its own
    React.useEffect(() => {
        engineAction("restore").then(() => refetch()).catch(() => {})
    }, [])
    const torrents = (data ?? []).filter(filter ?? (() => true))

    if (isError) return <LuffyError title="Torrent engine unavailable">
        <p>The movie torrent engine is not running. Restart Seanime and try again.</p>
    </LuffyError>

    if (!torrents.length) return <LuffyError title={null}>
        <p>Nothing downloading. Pick a movie and choose Download or Stream.</p>
    </LuffyError>

    return (
        <div className="space-y-3" data-movie-downloads>
            {torrents.map(t => <MovieDownloadRow key={t.hash} torrent={t} onChange={() => refetch()} />)}
        </div>
    )
}

function MovieDownloadRow({ torrent: t, onChange }: { torrent: Movie_EngineTorrent, onChange: () => void }) {
    const file = largestPlayableFile(t)
    const done = t.progress >= 1

    const run = (fn: () => Promise<unknown>) => fn().then(onChange).catch((e: any) => toast.error(e?.message ?? String(e)))

    return (
        <div className="border rounded-[--radius-md] bg-[--paper] p-4 space-y-3" data-movie-download-row>
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                    <p className="font-semibold line-clamp-1">{t.title}</p>
                    <p className="text-sm text-[--muted]">
                        {t.error ? <span className="text-red-300">{t.error}</span> : <>
                            {formatBytes(t.downloaded)} / {formatBytes(t.length)}
                            {!done && <> · {formatBytes(t.downloadSpeed)}/s · {t.peers} peers</>}
                        </>}
                    </p>
                </div>
                <Badge intent={t.mode === "download" ? "primary" : "gray"} leftIcon={t.mode === "download" ? <LuDownload /> : undefined}>
                    {t.mode === "download" ? "Download" : "Stream"}
                </Badge>
                {done && <Badge intent="success">Completed</Badge>}
                <Button
                    size="sm"
                    intent="white"
                    leftIcon={<BiPlay className="text-xl" />}
                    disabled={!t.ready || !file}
                    onClick={() => file && run(() => playEngineFile(file, t.title))}
                >
                    Play
                </Button>
                <Tooltip trigger={<IconButton
                    size="sm" intent="gray-subtle" icon={<LuRefreshCw />}
                    onClick={() => run(() => engineAction("resume", t.hash, t.title, t.mode))}
                />}>Resume</Tooltip>
                <Tooltip trigger={<IconButton
                    size="sm" intent="alert-subtle" icon={<BiStop />}
                    onClick={() => run(() => engineAction("stop", t.hash))}
                />}>Stop</Tooltip>
            </div>
            <ProgressBar
                size="sm"
                value={Math.round(t.progress * 100)}
                className={cn(done && "opacity-60")}
            />
        </div>
    )
}
