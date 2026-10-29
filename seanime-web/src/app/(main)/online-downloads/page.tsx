import { useScanLocalFiles } from "@/api/hooks/scan.hooks"
import { CustomLibraryBanner } from "@/app/(main)/_features/anime-library/_containers/custom-library-banner"
import { OnlineDownloadRow, PreparingDownloadRow } from "@/app/(main)/online-downloads/_components/online-download-row"
import {
    formatBytes,
    isActiveDownload,
    sendDownloadAction,
    useOnlineDownloads,
    usePreparingDownloads,
} from "@/app/(main)/online-downloads/_lib/online-downloads"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { Button } from "@/components/ui/button"
import { StaticTabs } from "@/components/ui/tabs"
import React from "react"

type Filter = "all" | "active" | "done" | "failed"

export default function Page() {
    const downloads = useOnlineDownloads()
    const preparing = usePreparingDownloads()
    const [filter, setFilter] = React.useState<Filter>("all")
    const { mutate: scan, isPending: isScanning } = useScanLocalFiles()
    const desktop = typeof window !== "undefined" && !!window.electron?.on

    const active = downloads.filter(isActiveDownload)
    const speed = active.reduce((n, d) => n + (d.state === "progressing" ? d.speed : 0), 0)
    const shown = downloads.filter(d => filter === "all" || (filter === "active" ? isActiveDownload(d)
        : filter === "done" ? d.state === "completed" : d.state === "failed" || d.state === "cancelled"))

    return (
        <>
            <CustomLibraryBanner discrete />
            <PageWrapper className="space-y-4 p-4 sm:p-8" data-online-downloads-page>
                <div className="flex flex-wrap items-center gap-3">
                    <div>
                        <h2>Online downloads</h2>
                        <p className="text-[--muted]">
                            Files from AnimeToki, AnimeKaizoku and AniDL.
                            {active.length ? ` ${active.length} downloading${speed ? ` at ${formatBytes(speed)}/s` : ""}.` : ""}
                        </p>
                    </div>
                    <div className="flex-1" />
                    <Button intent="gray-subtle" loading={isScanning}
                        onClick={() => scan({ enhanced: false, enhanceWithOfflineDatabase: false, skipLockedFiles: true, skipIgnoredFiles: true })}>
                        Scan library
                    </Button>
                    <Button intent="gray-subtle" disabled={downloads.length === active.length} onClick={() => sendDownloadAction("clear")}>
                        Clear finished
                    </Button>
                </div>

                {!desktop ? <p className="text-[--muted]">Online downloads need the Seanime desktop app.</p> : <>
                    <StaticTabs
                        className="h-10 w-fit border rounded-full"
                        triggerClass="px-4 py-1"
                        items={([["all", "All"], ["active", "Downloading"], ["done", "Saved"], ["failed", "Failed"]] as [Filter, string][]).map(([id, name]) => ({
                            name, isCurrent: filter === id, onClick: () => setFilter(id),
                        }))}
                    />
                    <div className="space-y-2" data-online-downloads-list>
                        {preparing.map(p => <PreparingDownloadRow key={p.key} p={p} showTitle />)}
                        {shown.map(d => <OnlineDownloadRow key={d.id} d={d} showTitle />)}
                        {!shown.length && !preparing.length && <p className="text-[--muted] py-8 text-center">
                            {downloads.length ? "Nothing here." : "No online downloads yet. Open an anime and press Online download."}
                        </p>}
                    </div>
                </>}
            </PageWrapper>
        </>
    )
}
