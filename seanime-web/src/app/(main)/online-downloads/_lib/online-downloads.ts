import { useScanLocalFiles } from "@/api/hooks/scan.hooks"
import React from "react"

/** A file download run by the desktop app for one of the direct-download websites. */
export type OnlineDownload = {
    id: string
    sourceId: string
    name: string
    path: string
    title: string
    mediaId: number
    received: number
    total: number
    speed: number
    state: "progressing" | "paused" | "interrupted" | "completed" | "cancelled" | "failed"
    started: number
    finished?: number
    error?: string
    /** Season archives are unpacked into their folder once downloaded */
    extract?: { state: "extracting", done: number, total: number } | { state: "done", episodes: number } | { state: "failed", error: string }
    /** Name of the archive that was unpacked and deleted */
    archive?: string
}

export type OnlineDownloadAction = "start" | "dir" | "list" | "cancel" | "pause" | "resume" | "retry" | "remove" | "clear" | "folder" | "open" | "unpack"

export function sendDownloadAction(action: OnlineDownloadAction, payload: Record<string, unknown> = {}) {
    window.electron?.emit?.("media-source:download", { action, ...payload })
}

// The desktop app owns the downloads, this only mirrors its list so the drawer, the page and the sidebar agree
let downloads: Record<string, OnlineDownload> = {}
const listeners = new Set<() => void>()
let attached = false
const unpackedListeners = new Set<(e: { mediaId: number, dir: string }) => void>()

function attach() {
    if (attached || typeof window === "undefined" || !window.electron?.on) return
    attached = true
    window.electron.on("media-source:event", (event: any) => {
        if (event?.type === "unpacked") return unpackedListeners.forEach(l => l(event))
        if (event?.type === "download" && typeof event.id === "string") downloads = { ...downloads, [event.id]: event }
        else if (event?.type === "downloads" && Array.isArray(event.list)) downloads = Object.fromEntries(event.list.map((d: OnlineDownload) => [d.id, d]))
        else return
        listeners.forEach(l => l())
    })
    sendDownloadAction("list")
}

function subscribe(listener: () => void) {
    attach()
    listeners.add(listener)
    return () => void listeners.delete(listener)
}

/** Newest first */
export function useOnlineDownloads() {
    const all = React.useSyncExternalStore(subscribe, () => downloads, () => downloads)
    return React.useMemo(() => Object.values(all).sort((a, b) => b.started - a.started), [all])
}

export const isActiveDownload = (d: OnlineDownload) => d.state === "progressing" || d.state === "paused" || d.state === "interrupted"

export function formatBytes(n: number) {
    if (!n) return "0 B"
    const u = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

/**
 * A website page loaded in an invisible webview of the site's own session, for reading its listings and following
 * its download steps the way a visitor's clicks would.
 */
export class HiddenPage {
    private view: any
    private ready: Promise<void>

    constructor(url: string, readonly sourceId: string, origins: string[] = []) {
        const view = this.view = document.createElement("webview") as any
        view.setAttribute("partition", "persist:seanime-media-source-" + sourceId)
        view.setAttribute("useragent", navigator.userAgent + " SeanimeSource/" + sourceId)
        view.setAttribute("webpreferences", "contextIsolation=yes,sandbox=yes,nodeIntegration=no")
        view.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:720px;opacity:0.01;pointer-events:none;z-index:-1;"
        view.setAttribute("src", url)
        const allow = Promise.all([url, ...origins].map(u => window.electron?.localServer?.allowWebviewOrigin?.(new URL(u).origin)))
        this.ready = Promise.race([allow, new Promise(r => setTimeout(r, 3000))]).catch(() => {}).then(() => {
            document.body.append(view)
        })
    }

    get url(): string {
        try { return this.view.getURL() }
        catch { return "" }
    }

    load(url: string) {
        this.view.loadURL(url).catch(() => {})
    }

    /** Runs `js` once, undefined when the page is not there yet or the script throws. */
    async run<T>(js: string): Promise<T | undefined> {
        await this.ready
        try { return await this.view.executeJavaScript(js) as T }
        catch { return undefined }
    }

    /** Runs `js` in the page until it returns something other than null/undefined/false. */
    async until<T>(js: string, timeout: number, signal?: AbortSignal, every = 1000): Promise<T | undefined> {
        const end = Date.now() + timeout
        while (Date.now() < end && !signal?.aborted) {
            const value = await this.run<T>(js)
            if (value !== null && value !== undefined && value !== false) return value
            await new Promise(r => setTimeout(r, every))
        }
        return undefined
    }

    close() {
        this.view.remove()
    }
}

export async function withHiddenPage<T>(url: string, sourceId: string, fn: (page: HiddenPage) => Promise<T>, origins?: string[]) {
    const page = new HiddenPage(url, sourceId, origins)
    try { return await fn(page) }
    finally { page.close() }
}

/** A download still being prepared in the app (following the site's steps to the file), before the desktop app takes it. */
export type PreparingDownload = { key: string, name: string, title: string, mediaId: number, sourceId: string, status: string, error?: string, started: number }

let preparing: Record<string, PreparingDownload> = {}
const preparingListeners = new Set<() => void>()

export function setPreparing(key: string, value: PreparingDownload | undefined) {
    const { [key]: _, ...rest } = preparing
    preparing = value ? { ...rest, [key]: value } : rest
    preparingListeners.forEach(l => l())
}

export function usePreparingDownloads() {
    const all = React.useSyncExternalStore(l => {
        preparingListeners.add(l)
        return () => void preparingListeners.delete(l)
    }, () => preparing, () => preparing)
    return React.useMemo(() => Object.values(all).sort((a, b) => b.started - a.started), [all])
}

/** Scans the anime library after a downloaded season archive was unpacked into it, so its episodes show up. */
export function useScanAfterUnpack() {
    const { mutate: scan } = useScanLocalFiles()
    const scanRef = React.useRef(scan)
    scanRef.current = scan
    React.useEffect(() => {
        attach()
        let timer: number | undefined
        // Several seasons finishing together share one scan
        const listener = () => {
            window.clearTimeout(timer)
            timer = window.setTimeout(() => scanRef.current({ enhanced: false, enhanceWithOfflineDatabase: false, skipLockedFiles: true, skipIgnoredFiles: true }), 3000)
        }
        unpackedListeners.add(listener)
        return () => {
            window.clearTimeout(timer)
            unpackedListeners.delete(listener)
        }
    }, [])
}
