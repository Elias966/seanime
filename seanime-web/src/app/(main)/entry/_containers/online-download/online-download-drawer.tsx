import { Anime_Entry } from "@/api/generated/types"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { OnlineFile, ONLINE_SITES, OnlineSite, startOnlineDownload } from "@/app/(main)/entry/_containers/online-download/online-download-sites"
import { OnlineDownloadRow, PreparingDownloadRow } from "@/app/(main)/online-downloads/_components/online-download-row"
import { isActiveDownload, sendDownloadAction, useOnlineDownloads, usePreparingDownloads } from "@/app/(main)/online-downloads/_lib/online-downloads"
import { SiteAgentDownload } from "@/app/(main)/movies/_containers/site-agent-download"
import { Modal } from "@/components/ui/modal"
import { SeaLink } from "@/components/shared/sea-link"
import { Button, IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { StaticTabs } from "@/components/ui/tabs"
import { Vaul, VaulContent } from "@/components/vaul"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { BiArrowBack, BiArrowToRight, BiCheck, BiDownload, BiLinkExternal, BiListUl, BiRefresh } from "react-icons/bi"
import { toast } from "sonner"

export const __onlineDownload_openAtom = atom(false)

// Ad scripts lay an invisible full-page frame over these sites and wait for the click to open a popup.
// The app blocks the popup, so the frame would never go away and every click would be swallowed.
const CLICK_TRAP_CSS = `iframe[style*="2147483647"][style*="opacity: 0"], div[style*="2147483647"][style*="opacity: 0"] { pointer-events: none !important; }`

type FileList = { loading: boolean, files: OnlineFile[], error?: string }

function safeFolder(name: string) {
    return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Anime"
}

/** Dual-audio files count as both */
function fileAudio(f: OnlineFile) {
    const s = `${f.name} ${f.note ?? ""}`
    if (/dual|multi[ -]?audio/i.test(s)) return ["sub", "dub"]
    return /\bdub(bed)?\b/i.test(s) ? ["dub"] : ["sub"]
}

const baseName = (s: string) => s.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/ \(\d+\)$/, "").toLowerCase()

export function OnlineDownloadDrawer({ entry }: { entry: Anime_Entry }) {
    const [open, setOpen] = useAtom(__onlineDownload_openAtom)
    const serverStatus = useServerStatus()
    const [siteId, setSiteId] = React.useState(ONLINE_SITES[0].id)
    const [lists, setLists] = React.useState<Record<string, FileList>>({})
    const [browsing, setBrowsing] = React.useState<string[]>([])
    const [filter, setFilter] = React.useState("")
    const [audio, setAudio] = React.useState<"all" | "sub" | "dub">("all")
    const [selected, setSelected] = React.useState<Set<string>>(new Set())
    const [queueing, setQueueing] = React.useState(false)
    const [aiOpen, setAiOpen] = React.useState(false)
    const downloads = useOnlineDownloads()
    const preparing = usePreparingDownloads()

    const media = entry.media
    const title = media?.title?.userPreferred || media?.title?.romaji || ""
    const libraryPath = serverStatus?.settings?.library?.libraryPath || ""
    const folder = libraryPath ? `${libraryPath.replace(/[\\/]+$/, "")}${libraryPath.includes("\\") ? "\\" : "/"}${safeFolder(title)}` : ""
    const desktop = typeof window !== "undefined" && !!window.electron?.on && !!window.electron?.localServer?.allowWebviewOrigin
    const site = ONLINE_SITES.find(s => s.id === siteId)!

    // Files the user gets by browsing a site also go into the anime's folder (or Downloads/Seanime when no library is set)
    React.useEffect(() => {
        if (!open || !desktop || !folder) return
        for (const s of ONLINE_SITES) sendDownloadAction("dir", { sourceId: s.id, dir: folder, title, mediaId: entry.mediaId })
    }, [open, desktop, folder])

    const load = React.useCallback((s: OnlineSite) => {
        if (!media) return
        setLists(l => ({ ...l, [s.id]: { loading: true, files: l[s.id]?.files ?? [] } }))
        s.list(media, new AbortController().signal)
            .then(files => setLists(l => ({ ...l, [s.id]: { loading: false, files } })))
            .catch(() => setLists(l => ({ ...l, [s.id]: { loading: false, files: [], error: `${s.name} did not answer.` } })))
    }, [media?.id])

    React.useEffect(() => {
        if (open && desktop && !lists[siteId]) load(site)
    }, [open, desktop, siteId])

    React.useEffect(() => {
        if (!open) setBrowsing([])
    }, [open])

    const mine = downloads.filter(d => d.mediaId === entry.mediaId)
    const minePreparing = preparing.filter(p => p.mediaId === entry.mediaId)
    const list = lists[siteId]
    const shown = (list?.files ?? [])
        .filter(f => !filter || f.name.toLowerCase().includes(filter.toLowerCase()) || String(f.episode) === filter.trim())
        .filter(f => audio === "all" || fileAudio(f).includes(audio))
        .sort((a, b) => (b.episode ?? 0) - (a.episode ?? 0) || a.name.localeCompare(b.name))

    const download = async (f: OnlineFile) => {
        toast.info(`Preparing ${f.name}`)
        const ok = await startOnlineDownload(site, f, { title, mediaId: entry.mediaId, dir: folder || undefined })
        if (ok) toast.success("Download started. Follow it in Online downloads.")
    }

    // The selection is per site, so switching sites starts a new one
    React.useEffect(() => setSelected(new Set()), [siteId])

    const downloadSelected = async () => {
        const files = shown.filter(f => selected.has(f.key) && !fileState(f))
        if (!files.length) return
        setQueueing(true)
        toast.info(`Preparing ${files.length} file${files.length > 1 ? "s" : ""}`)
        // One at a time: each file is found through the site's own pages
        let started = 0
        for (const f of files) {
            if (await startOnlineDownload(site, f, { title, mediaId: entry.mediaId, dir: folder || undefined })) started++
            setSelected(s => {
                const n = new Set(s)
                n.delete(f.key)
                return n
            })
        }
        setQueueing(false)
        if (started) toast.success(`${started} download${started > 1 ? "s" : ""} started. Follow them in Online downloads.`)
    }

    const fileState = (f: OnlineFile) => {
        if (preparing.some(p => p.key === site.id + ":" + f.key && !p.error)) return "preparing"
        const d = mine.find(d => baseName(d.name) === baseName(f.name))
        return d ? (isActiveDownload(d) ? "downloading" : d.state === "completed" ? "saved" : undefined) : undefined
    }

    return (
        <Vaul open={open} onOpenChange={setOpen}>
            <VaulContent className="bg-gray-950 h-[92%] mx-4 xl:mx-[6rem] overflow-hidden" data-online-download-drawer>
                <div className="p-4 lg:p-6 flex flex-col gap-3 h-full">
                    <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-xl font-semibold">Online download</h3>
                        <span className="text-[--muted] text-sm truncate max-w-[40ch]">{title}</span>
                        <span className="text-xs text-[--muted] ml-auto truncate max-w-[50ch]">Saving to {folder || "Downloads/Seanime"}</span>
                        <Button size="sm" intent="white" leftIcon={<BiDownload />} onClick={() => setAiOpen(true)} data-anime-ai-download>Download with AI</Button>
                        <Modal open={aiOpen} onOpenChange={setAiOpen} title={`Download ${title}`} contentClass="max-w-3xl">
                            <div className="h-[70vh] flex flex-col">
                                <SiteAgentDownload kind="anime" title={title} dir={folder} episodes={Array.from({ length: media?.episodes || entry.currentEpisodeCount || 0 }, (_, i) => i + 1)} />
                            </div>
                        </Modal>
                        <SeaLink href="/online-downloads" onClick={() => setOpen(false)}>
                            <Button size="sm" intent="gray-subtle" leftIcon={<BiListUl />}>Online downloads</Button>
                        </SeaLink>
                    </div>

                    {!desktop ? <p className="text-[--muted]">Online downloads need the Seanime desktop app.</p> : <>
                        <StaticTabs
                            className="h-10 border-b"
                            items={ONLINE_SITES.map(s => ({ name: s.name, isCurrent: s.id === siteId, onClick: () => setSiteId(s.id) }))}
                        />

                        <div className="flex gap-4 flex-1 min-h-0">
                            <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">
                                {browsing.includes(siteId)
                                    ? <SiteBrowser site={site} title={title} onClose={() => setBrowsing(b => b.filter(x => x !== siteId))} />
                                    : <>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm text-[--muted]">{site.about}</p>
                                            <div className="flex-1" />
                                            <select
                                                className="rounded-md bg-gray-900 border px-2 text-sm h-8"
                                                value={audio}
                                                onChange={e => setAudio(e.target.value as typeof audio)}
                                                data-online-download-audio
                                            >
                                                <option value="all">Sub and dub</option>
                                                <option value="sub">Sub only</option>
                                                <option value="dub">Dub only</option>
                                            </select>
                                            <input
                                                className="w-44 rounded-md bg-gray-900 border px-2 text-sm h-8"
                                                placeholder="Filter or episode"
                                                value={filter}
                                                onChange={e => setFilter(e.target.value)}
                                            />
                                            <IconButton size="sm" intent="gray-basic" icon={<BiRefresh />} loading={list?.loading} onClick={() => load(site)} />
                                            <Button size="sm" intent="gray-subtle" leftIcon={<BiLinkExternal />}
                                                onClick={() => setBrowsing(b => [...b, siteId])}>Browse {site.name}</Button>
                                        </div>

                                        {!!shown.length && (() => {
                                            const free = shown.filter(f => !fileState(f))
                                            const all = free.length > 0 && free.every(f => selected.has(f.key))
                                            const count = free.filter(f => selected.has(f.key)).length
                                            return <div className="flex items-center gap-3 text-sm">
                                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                                    <input
                                                        type="checkbox" className="w-4 h-4 accent-[--brand]" checked={all} disabled={!free.length}
                                                        onChange={() => setSelected(all ? new Set() : new Set(free.map(f => f.key)))}
                                                        data-online-download-select-all
                                                    />
                                                    Select all{free.length ? ` (${free.length})` : ""}
                                                </label>
                                                <Button
                                                    size="sm" intent="primary" leftIcon={<BiDownload />} disabled={!count} loading={queueing}
                                                    onClick={downloadSelected} data-online-download-selected
                                                >Download selected{count ? ` (${count})` : ""}</Button>
                                            </div>
                                        })()}

                                        <div className="flex-1 overflow-y-auto space-y-2 pr-1" data-online-download-files={siteId}>
                                            {list?.loading && !list.files.length && <div className="flex items-center gap-3 text-[--muted] py-6">
                                                <LoadingSpinner className="w-6 h-6 m-0" /> Looking for {title} on {site.name}…
                                            </div>}
                                            {list?.error && <p className="text-sm text-red-400">{list.error}</p>}
                                            {list && !list.loading && !list.files.length && !list.error && <p className="text-sm text-[--muted] py-4">
                                                {site.name} has no files for this anime. Try another site, or browse {site.name} yourself.
                                            </p>}
                                            {shown.map(f => {
                                                const state = fileState(f)
                                                return (
                                                    <div key={f.key} className="rounded-[--radius-md] border bg-[--paper] px-3 py-2 flex items-center gap-3"
                                                        data-online-download-file>
                                                        <input
                                                            type="checkbox" className="w-4 h-4 flex-none accent-[--brand]"
                                                            checked={!state && selected.has(f.key)} disabled={!!state}
                                                            onChange={() => setSelected(s => {
                                                                const n = new Set(s)
                                                                if (n.has(f.key)) n.delete(f.key)
                                                                else n.add(f.key)
                                                                return n
                                                            })}
                                                            data-online-download-check
                                                        />
                                                        {f.episode !== undefined && <span className="text-lg font-bold w-12 text-center flex-none">{f.episode}</span>}
                                                        <div className="flex-1 min-w-0">
                                                            <p className="truncate text-sm" title={f.name}>{f.name}</p>
                                                            <div className="flex gap-1.5 flex-wrap text-xs text-[--muted] mt-0.5">
                                                                {f.quality && <span className="px-1.5 rounded bg-gray-800 text-white">{f.quality}</span>}
                                                                {f.size && <span>{f.size}</span>}
                                                                <span className="px-1.5 rounded bg-gray-800">{fileAudio(f).length > 1 ? "Sub + Dub" : fileAudio(f)[0] === "dub" ? "Dub" : "Sub"}</span>
                                                                {f.note && <span>· {f.note}</span>}
                                                            </div>
                                                        </div>
                                                        {state === "saved"
                                                            ? <Button size="sm" intent="success-subtle" leftIcon={<BiCheck />} disabled>Saved</Button>
                                                            : <Button
                                                                size="sm" intent="primary-subtle" leftIcon={<BiDownload />}
                                                                loading={state === "preparing"} disabled={state === "downloading"}
                                                                onClick={() => download(f)}
                                                                data-online-download-start
                                                            >{state === "downloading" ? "Downloading" : state === "preparing" ? "Preparing" : "Download"}</Button>}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </>}
                            </div>

                            <div className="w-[24rem] flex-none flex flex-col gap-2 overflow-y-auto" data-online-download-list>
                                <p className="font-semibold">This anime's downloads</p>
                                {!mine.length && !minePreparing.length && <p className="text-sm text-[--muted]">
                                    Nothing yet. Press Download on a file; it keeps going when you close this.
                                </p>}
                                {minePreparing.map(p => <PreparingDownloadRow key={p.key} p={p} />)}
                                {mine.map(d => <OnlineDownloadRow key={d.id} d={d} />)}
                            </div>
                        </div>
                    </>}
                </div>
            </VaulContent>
        </Vaul>
    )
}

/** The site itself, for files the list does not show. Files downloaded from it are caught and saved the same way. */
export function SiteBrowser({ site, title, url, onClose, backLabel = "Back to the file list", children }: {
    site: Pick<OnlineSite, "id" | "origin" | "browseUrl" | "adsAllowed">, title: string, url?: string, onClose: () => void, backLabel?: string, children?: React.ReactNode
}) {
    const holder = React.useRef<HTMLDivElement>(null)
    const view = React.useRef<any>(null)
    const [popups, setPopups] = React.useState<string[]>([])

    React.useEffect(() => {
        const el = holder.current
        if (!el) return
        const v = view.current = document.createElement("webview") as any
        v.setAttribute("partition", "persist:seanime-media-source-" + site.id)
        v.setAttribute("useragent", navigator.userAgent + " SeanimeSource/" + site.id)
        v.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no")
        // Without it the page's window.open never reaches the app; the app still denies the popup and only reports its address
        v.setAttribute("allowpopups", "")
        v.setAttribute("src", url ?? site.browseUrl(title))
        v.style.cssText = "width:100%;height:100%;border:0;background:#fff;"
        let guestId = -1
        v.addEventListener("dom-ready", () => {
            try { guestId = v.getWebContentsId() }
            catch {}
            v.insertCSS(CLICK_TRAP_CSS).catch(() => {})
        })
        const off = window.electron!.on("media-source:event", (event: any) => {
            if (event?.type !== "popup" || typeof event.url !== "string" || event.guestId !== guestId) return
            // A popup to the page's own site is the link the user pressed; other hosts are usually ads
            let same = false
            try { same = new URL(event.url).origin === new URL(v.getURL()).origin }
            catch {}
            if (same) v.loadURL(event.url)
            else if (!site.adsAllowed) setPopups(p => [event.url, ...p.filter(u => u !== event.url)].slice(0, 3))
        })
        const allow = window.electron!.localServer.allowWebviewOrigin!(site.origin)
        Promise.race([allow, new Promise(r => setTimeout(r, 3000))]).catch(() => {}).finally(() => el.append(v))
        return () => {
            off?.()
            v.remove()
        }
    }, [site.id, url])

    const v = () => view.current
    return (
        <>
            <div className="flex items-center gap-2">
                <Button size="sm" intent="gray-subtle" leftIcon={<BiListUl />} onClick={onClose}>{backLabel}</Button>
                <IconButton size="sm" intent="gray-basic" icon={<BiArrowBack />} onClick={() => v()?.canGoBack() && v().goBack()} />
                <IconButton size="sm" intent="gray-basic" icon={<BiArrowToRight />} onClick={() => v()?.canGoForward() && v().goForward()} />
                <IconButton size="sm" intent="gray-basic" icon={<BiRefresh />} onClick={() => v()?.reload()} />
                {popups.map(u => <Button key={u} size="sm" intent="gray-subtle" leftIcon={<BiLinkExternal />}
                    onClick={() => {
                        v()?.loadURL(u)
                        setPopups([])
                    }}>Open {new URL(u).hostname}</Button>)}
                {children}
            </div>
            <div ref={holder} className={cn("flex-1 min-h-0 rounded-md overflow-hidden border")} />
        </>
    )
}

export function OnlineDownloadButton({ onClick }: { onClick?: () => void }) {
    const [, setOpen] = useAtom(__onlineDownload_openAtom)
    return (
        <Button
            intent="gray-subtle" size="md" leftIcon={<BiDownload className="text-2xl" />}
            onClick={() => {
                setOpen(true)
                onClick?.()
            }}
            data-online-download-button
        >
            Online download
        </Button>
    )
}
