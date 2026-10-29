import { Anime_Entry } from "@/api/generated/types"
import { useScanLocalFiles } from "@/api/hooks/scan.hooks"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { Button, IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { StaticTabs } from "@/components/ui/tabs"
import { Vaul, VaulContent } from "@/components/vaul"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { BiArrowBack, BiArrowToRight, BiDownload, BiLinkExternal, BiRefresh, BiX } from "react-icons/bi"

export const __onlineDownload_openAtom = atom(false)

// adsAllowed: uBlock Origin lets this site's ads run (its buttons stop working without them),
// so its popups to other sites are ads and are dropped.
type OnlineSite = { id: string, name: string, origin: string, url: (title: string) => string, note: string, adsAllowed?: boolean }

// The three direct-download sites. Their pages are shown as they are; files the user gets from them
// are caught by the desktop app and saved into the library folder.
const SITES: OnlineSite[] = [
    {
        id: "animetoki", name: "AnimeToki", origin: "https://animetoki.com",
        url: t => `https://animetoki.com/?s=${encodeURIComponent(t)}`,
        note: "Airing episodes with a direct file download in one click from the list on the right.",
    },
    {
        id: "animekaizoku", name: "AnimeKaizoku", origin: "https://animekaizoku.xyz",
        url: t => `https://animekaizoku.xyz/?s=${encodeURIComponent(t)}`,
        note: "Pick a quality, then press Download on the Kaizoku Files page. Some links pass through a shortener you complete here.",
    },
    {
        id: "anidl", name: "AniDL", origin: "https://anidl.org",
        url: t => `https://anidl.org/on-going?q=${encodeURIComponent(t)}`,
        note: "Press Generate, then Get, then a mirror (Pixeldrain works well). Older series are under Index; some links need a shortener.",
        adsAllowed: true,
    },
]

// Ad scripts lay an invisible full-page frame over these sites and wait for the click to open a popup.
// The app blocks the popup, so the frame would never go away and every click would be swallowed.
const CLICK_TRAP_CSS = `iframe[style*="2147483647"][style*="opacity: 0"], div[style*="2147483647"][style*="opacity: 0"] { pointer-events: none !important; }`

type DownloadItem = { id: string, sourceId: string, name: string, path: string, received: number, total: number, state: string }
type TokiPost = { title: string, link: string, date: string, files: string[] }

function formatBytes(n: number) {
    if (!n) return "0 B"
    const u = ["B", "KB", "MB", "GB"]
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

function safeFolder(name: string) {
    return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Anime"
}

// Runs inside the AnimeToki page, so the WordPress API is fetched same-origin
function tokiSearch(q: string) {
    return fetch("/wp-json/wp/v2/posts?per_page=20&_fields=id,link,title,content,date&search=" + encodeURIComponent(q))
        .then(r => r.json() as Promise<any[]>)
        .then((posts: any[]) => posts.map(p => {
            const doc = new DOMParser().parseFromString(p.content?.rendered || "", "text/html")
            const files = Array.from(doc.querySelectorAll("video[src],source[src],a[href]"))
                .map(e => e.getAttribute("src") || e.getAttribute("href") || "")
                .filter(u => /^https:\/\/.+\.(mkv|mp4)(\?|$)/i.test(u))
            const title = new DOMParser().parseFromString(p.title?.rendered || "", "text/html").body.textContent || ""
            return { title, link: p.link, date: p.date, files: Array.from(new Set(files)) }
        }))
}

export function OnlineDownloadDrawer({ entry }: { entry: Anime_Entry }) {
    const [open, setOpen] = useAtom(__onlineDownload_openAtom)
    const serverStatus = useServerStatus()
    const [siteId, setSiteId] = React.useState(SITES[0].id)
    const [visited, setVisited] = React.useState<string[]>([SITES[0].id])
    const [downloads, setDownloads] = React.useState<Record<string, DownloadItem>>({})
    const [popups, setPopups] = React.useState<Record<string, string[]>>({})
    const views = React.useRef<Record<string, any>>({})
    const guests = React.useRef<Record<number, string>>({})
    const { mutate: scan, isPending: isScanning } = useScanLocalFiles()

    const title = entry.media?.title?.userPreferred || entry.media?.title?.romaji || ""
    const libraryPath = serverStatus?.settings?.library?.libraryPath || ""
    const folder = libraryPath ? `${libraryPath.replace(/[\\/]+$/, "")}${libraryPath.includes("\\") ? "\\" : "/"}${safeFolder(title)}` : ""
    const desktop = typeof window !== "undefined" && !!window.electron?.on && !!window.electron?.localServer?.allowWebviewOrigin

    React.useEffect(() => {
        if (!desktop) return
        return window.electron!.on("media-source:event", (event: any) => {
            if (event?.type === "download" && typeof event.id === "string") {
                setDownloads(d => ({ ...d, [event.id]: event }))
            }
            else if (event?.type === "popup" && typeof event.url === "string" && guests.current[event.guestId]) {
                const id = guests.current[event.guestId], view = views.current[id]
                // A popup to the page's own site is the link the user pressed; other hosts are usually ads
                let same = false
                try { same = new URL(event.url).origin === new URL(view?.getURL()).origin }
                catch {}
                if (same) view.loadURL(event.url)
                else if (!SITES.find(s => s.id === id)?.adsAllowed) setPopups(p => ({ ...p, [id]: [event.url, ...(p[id] || []).filter((u: string) => u !== event.url)].slice(0, 3) }))
            }
        })
    }, [desktop])

    // Files go into the anime's folder in the library (or Downloads/Seanime when no library is set)
    React.useEffect(() => {
        if (!open || !desktop || !folder) return
        for (const site of SITES) window.electron!.emit("media-source:download", { action: "dir", sourceId: site.id, dir: folder })
    }, [open, desktop, folder])

    const selectSite = (id: string) => {
        setSiteId(id)
        setVisited(v => v.includes(id) ? v : [...v, id])
    }

    const mountView = React.useCallback((site: OnlineSite, el: HTMLDivElement | null) => {
        if (!el || views.current[site.id]) return
        const view = document.createElement("webview") as any
        view.setAttribute("partition", "persist:seanime-media-source-" + site.id)
        view.setAttribute("useragent", navigator.userAgent + " SeanimeSource/" + site.id)
        view.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no")
        // Without it the page's window.open never reaches the app; the app still denies the popup and only reports its address
        view.setAttribute("allowpopups", "")
        view.setAttribute("src", site.url(title))
        view.style.cssText = "width:100%;height:100%;border:0;background:#fff;"
        view.addEventListener("dom-ready", () => {
            try { guests.current[view.getWebContentsId()] = site.id }
            catch {}
            view.insertCSS(CLICK_TRAP_CSS).catch(() => {})
        })
        views.current[site.id] = view
        const allow = window.electron!.localServer.allowWebviewOrigin!(site.origin)
        Promise.race([allow, new Promise(r => setTimeout(r, 3000))]).catch(() => {}).finally(() => el.append(view))
    }, [title])

    // The webviews are dropped when the drawer closes; the downloads keep going in the app
    React.useEffect(() => {
        if (open) return
        Object.values(views.current).forEach(v => v.remove())
        views.current = {}
        guests.current = {}
        setVisited([siteId])
    }, [open])

    const view = () => views.current[siteId]
    const site = SITES.find(s => s.id === siteId)!
    const list = Object.values(downloads).reverse()

    return (
        <Vaul open={open} onOpenChange={setOpen}>
            <VaulContent className="bg-gray-950 h-[92%] mx-4 xl:mx-[6rem] overflow-hidden" data-online-download-drawer>
                <div className="p-4 lg:p-6 flex flex-col gap-3 h-full">
                    <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-xl font-semibold">Online download</h3>
                        <span className="text-[--muted] text-sm truncate max-w-[40ch]">{title}</span>
                        <span className="text-xs text-[--muted] ml-auto truncate max-w-[50ch]">
                            Saving to {folder || "Downloads/Seanime"}
                        </span>
                    </div>

                    {!desktop ? <p className="text-[--muted]">Online downloads need the Seanime desktop app.</p> : <>
                        <StaticTabs
                            className="h-10 border-b"
                            items={SITES.map(s => ({ name: s.name, isCurrent: s.id === siteId, onClick: () => selectSite(s.id) }))}
                        />

                        <div className="flex items-center gap-2">
                            <IconButton size="sm" intent="gray-basic" icon={<BiArrowBack />} onClick={() => view()?.canGoBack() && view().goBack()} />
                            <IconButton size="sm" intent="gray-basic" icon={<BiArrowToRight />} onClick={() => view()?.canGoForward() && view().goForward()} />
                            <IconButton size="sm" intent="gray-basic" icon={<BiRefresh />} onClick={() => view()?.reload()} />
                            <Button size="sm" intent="gray-subtle" onClick={() => view()?.loadURL(site.url(title))}>Search "{title.slice(0, 40)}"</Button>
                            {(popups[siteId] || []).map(u => <Button
                                key={u} size="sm" intent="gray-subtle" leftIcon={<BiLinkExternal />}
                                onClick={() => {
                                    view()?.loadURL(u)
                                    setPopups(p => ({ ...p, [siteId]: [] }))
                                }}
                            >Open {new URL(u).hostname}</Button>)}
                            <p className="text-xs text-[--muted] ml-2 hidden lg:block">{site.note}</p>
                        </div>

                        <div className="flex gap-3 flex-1 min-h-0">
                            <div className="flex-1 min-w-0 rounded-md overflow-hidden border relative">
                                {SITES.filter(s => visited.includes(s.id)).map(s => (
                                    <div
                                        key={s.id}
                                        ref={el => mountView(s, el)}
                                        className={cn("absolute inset-0", s.id !== siteId && "invisible")}
                                    />
                                ))}
                            </div>

                            <div className="w-[22rem] flex-none flex flex-col gap-3 overflow-y-auto">
                                {siteId === "animetoki" && <TokiList view={() => views.current.animetoki} title={entry.media?.title?.english || title} />}

                                <div className="space-y-2" data-online-download-list>
                                    <div className="flex items-center gap-2">
                                        <p className="font-semibold">Downloads</p>
                                        <Button
                                            size="xs" intent="gray-subtle" className="ml-auto" loading={isScanning}
                                            onClick={() => scan({ enhanced: false, enhanceWithOfflineDatabase: false, skipLockedFiles: true, skipIgnoredFiles: true })}
                                        >Scan library</Button>
                                    </div>
                                    {!list.length && <p className="text-sm text-[--muted]">Nothing yet. Files you download on these sites appear here.</p>}
                                    {list.map(d => (
                                        <div key={d.id} className="rounded-md border p-2 text-sm space-y-1">
                                            <div className="flex items-center gap-2">
                                                <p className="truncate flex-1" title={d.path}>{d.name}</p>
                                                {d.state === "progressing" && <IconButton
                                                    size="xs" intent="alert-basic" icon={<BiX />}
                                                    onClick={() => window.electron!.emit("media-source:download", { action: "cancel", id: d.id })}
                                                />}
                                            </div>
                                            <div className="h-1.5 rounded bg-gray-800 overflow-hidden">
                                                <div
                                                    className={cn("h-full", d.state === "completed" ? "bg-green-500" : d.state === "progressing" ? "bg-[--brand]" : "bg-red-500")}
                                                    style={{ width: `${d.total ? Math.min(100, d.received / d.total * 100) : d.state === "completed" ? 100 : 5}%` }}
                                                />
                                            </div>
                                            <p className="text-xs text-[--muted]">
                                                {d.state === "completed" ? "Saved" : d.state === "progressing" ? "Downloading" : d.state === "cancelled" ? "Cancelled" : "Failed"}
                                                {" · "}{formatBytes(d.received)}{d.total ? ` / ${formatBytes(d.total)}` : ""}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </>}
                </div>
            </VaulContent>
        </Vaul>
    )
}

function TokiList({ view, title }: { view: () => any, title: string }) {
    const [query, setQuery] = React.useState(title)
    const [posts, setPosts] = React.useState<TokiPost[] | null>(null)
    const [error, setError] = React.useState("")
    const [loading, setLoading] = React.useState(false)

    const run = async () => {
        const v = view()
        if (!v) return
        setLoading(true)
        setError("")
        try {
            const result = await v.executeJavaScript(`(${tokiSearch.toString()})(${JSON.stringify(query)})`)
            setPosts(Array.isArray(result) ? result as TokiPost[] : [])
        }
        catch {
            setError("AnimeToki did not answer. Wait for the page to load and try again.")
        }
        finally {
            setLoading(false)
        }
    }

    const withFiles = posts?.filter(p => p.files.length) ?? []

    return (
        <div className="space-y-2" data-online-download-toki>
            <p className="font-semibold">AnimeToki direct files</p>
            <div className="flex gap-2">
                <input
                    className="flex-1 min-w-0 rounded-md bg-gray-900 border px-2 text-sm h-8"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && run()}
                />
                <Button size="sm" intent="gray-subtle" loading={loading} onClick={run}>Find</Button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            {posts && !withFiles.length && <p className="text-xs text-[--muted]">
                No direct files found. Open a post in the page instead; its downloads are saved too.
            </p>}
            {withFiles.map(p => (
                <div key={p.link} className="rounded-md border p-2 text-sm space-y-1">
                    <p className="line-clamp-2">{p.title}</p>
                    {p.files.map(f => (
                        <Button
                            key={f} size="xs" intent="primary-subtle" leftIcon={<BiDownload />} className="w-full justify-start"
                            onClick={() => window.electron!.emit("media-source:download", { action: "start", sourceId: "animetoki", url: f, referer: "https://animetoki.com/" })}
                        >
                            <span className="truncate">{decodeURIComponent(f.split("/").pop() || "File")}</span>
                        </Button>
                    ))}
                </div>
            ))}
        </div>
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
