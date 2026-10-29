import { ONLINE_SITES } from "@/app/(main)/entry/_containers/online-download/online-download-sites"
import {
    formatBytes,
    OnlineDownload,
    PreparingDownload,
    sendDownloadAction,
    setPreparing,
} from "@/app/(main)/online-downloads/_lib/online-downloads"
import { SeaLink } from "@/components/shared/sea-link"
import { IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Tooltip } from "@/components/ui/tooltip"
import React from "react"
import { BiFolderOpen, BiPause, BiPlay, BiRefresh, BiTrash, BiX } from "react-icons/bi"

const siteName = (id: string) => ONLINE_SITES.find(s => s.id === id)?.name || id

const STATE_LABEL: Record<OnlineDownload["state"], string> = {
    progressing: "Downloading", paused: "Paused", interrupted: "Interrupted", completed: "Saved", cancelled: "Cancelled", failed: "Failed",
}

function formatEta(seconds: number) {
    if (!isFinite(seconds) || seconds <= 0) return ""
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = Math.floor(seconds % 60)
    return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`
}

function Action({ label, icon, onClick, intent = "gray-basic" }: { label: string, icon: React.ReactElement, onClick: () => void, intent?: any }) {
    return <Tooltip trigger={<IconButton size="sm" intent={intent} icon={icon} onClick={onClick} aria-label={label} />}>{label}</Tooltip>
}

export function OnlineDownloadRow({ d, showTitle }: { d: OnlineDownload, showTitle?: boolean }) {
    const act = (action: Parameters<typeof sendDownloadAction>[0]) => () => sendDownloadAction(action, { id: d.id })
    const pct = d.total ? Math.min(100, d.received / d.total * 100) : d.state === "completed" ? 100 : 0
    const running = d.state === "progressing"
    const eta = running && d.speed > 0 && d.total ? formatEta((d.total - d.received) / d.speed) : ""

    return (
        <div className="rounded-[--radius-md] border bg-[--paper] p-3 space-y-2" data-online-download-item={d.state}>
            <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                    <p className="truncate font-medium" title={d.path || d.name}>{d.name}</p>
                    <p className="text-xs text-[--muted] truncate">
                        {showTitle && d.title && (d.mediaId
                            ? <SeaLink href={`/entry?id=${d.mediaId}`} className="hover:underline">{d.title}</SeaLink>
                            : d.title)}
                        {showTitle && d.title && " · "}
                        {siteName(d.sourceId)}
                    </p>
                </div>
                <div className="flex items-center gap-1 flex-none">
                    {running && <Action label="Pause" icon={<BiPause />} onClick={act("pause")} />}
                    {(d.state === "paused" || d.state === "interrupted") && <Action label="Resume" icon={<BiPlay />} onClick={act("resume")} />}
                    {(running || d.state === "paused" || d.state === "interrupted") &&
                        <Action label="Cancel" icon={<BiX />} intent="alert-basic" onClick={act("cancel")} />}
                    {d.state === "completed" && <Action label="Open" icon={<BiPlay />} onClick={act("open")} />}
                    {(d.state === "failed" || d.state === "cancelled") && <Action label="Retry" icon={<BiRefresh />} onClick={act("retry")} />}
                    {d.path && <Action label="Show in folder" icon={<BiFolderOpen />} onClick={act("folder")} />}
                    {!running && d.state !== "paused" && d.state !== "interrupted" &&
                        <Action label="Remove from list" icon={<BiTrash />} onClick={act("remove")} />}
                </div>
            </div>
            <div className="h-1.5 rounded bg-gray-800 overflow-hidden">
                <div
                    className={cn("h-full transition-[width]",
                        d.state === "completed" ? "bg-green-500" : running ? "bg-[--brand]" : d.state === "paused" || d.state === "interrupted"
                            ? "bg-yellow-500" : "bg-red-500")}
                    style={{ width: `${d.state === "failed" || d.state === "cancelled" ? 100 : Math.max(pct, running ? 2 : 0)}%` }}
                />
            </div>
            <p className="text-xs text-[--muted]">
                {STATE_LABEL[d.state] || d.state}
                {d.total || d.received ? ` · ${formatBytes(d.received)}${d.total ? ` / ${formatBytes(d.total)} (${pct.toFixed(0)}%)` : ""}` : ""}
                {running && d.speed > 0 ? ` · ${formatBytes(d.speed)}/s` : ""}
                {eta ? ` · ${eta} left` : ""}
                {d.error ? ` · ${d.error}` : ""}
            </p>
        </div>
    )
}

export function PreparingDownloadRow({ p, showTitle }: { p: PreparingDownload, showTitle?: boolean }) {
    return (
        <div className="rounded-[--radius-md] border border-dashed bg-[--paper] p-3 flex items-center gap-3" data-online-download-preparing>
            {!p.error && <LoadingSpinner className="w-5 h-5 m-0 flex-none" />}
            <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{p.name}</p>
                <p className={cn("text-xs truncate", p.error ? "text-red-400" : "text-[--muted]")}>
                    {showTitle && p.title ? `${p.title} · ` : ""}{siteName(p.sourceId)} · {p.error || p.status}
                </p>
            </div>
            {p.error && <Action label="Dismiss" icon={<BiX />} onClick={() => setPreparing(p.key, undefined)} />}
        </div>
    )
}
