import { AL_BaseAnime } from "@/api/generated/types"
import { HiddenPage, sendDownloadAction, setPreparing, withHiddenPage } from "@/app/(main)/online-downloads/_lib/online-downloads"

/** One downloadable file a site offers for the anime. `resolve` follows the site's steps to the file's address. */
export type OnlineFile = {
    key: string
    name: string
    episode?: number
    quality?: string
    size?: string
    note?: string
    resolve: (signal: AbortSignal, status: (s: string) => void) => Promise<{ url: string, referer?: string }>
}

// adsAllowed: uBlock Origin lets this site's ads run (its buttons stop working without them),
// so its popups to other sites are ads and are dropped.
export type OnlineSite = {
    id: string
    name: string
    origin: string
    /** The site's own search, for browsing it when the list misses something */
    browseUrl: (title: string) => string
    about: string
    adsAllowed?: boolean
    list: (media: AL_BaseAnime, signal: AbortSignal) => Promise<OnlineFile[]>
}

const alnum = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "")
const unique = (xs: (string | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x)))
const queries = (m: AL_BaseAnime) => unique([m.title?.romaji, m.title?.english])
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function fileEpisode(name: string) {
    const m = name.match(/S\d+\s*-?\s*E(\d{1,4})/i) || name.match(/\bEpisode\s*(\d{1,4})/i) || name.match(/ - (\d{1,4})(?:v\d)?\b/) || name.match(/\bE(\d{1,4})\b/)
    return m ? Number(m[1]) : undefined
}

export const fileQuality = (name: string) => name.match(/\b(2160|1080|720|480|360)p\b/i)?.[0].toLowerCase()

// Runs inside the AnimeToki page, so the WordPress API is fetched same-origin
function tokiSearch(q: string) {
    return fetch("/wp-json/wp/v2/posts?per_page=30&_fields=id,link,title,content,date&search=" + encodeURIComponent(q))
        .then(r => r.json() as Promise<any[]>)
        .then((posts: any[]) => posts.map(p => {
            const doc = new DOMParser().parseFromString(p.content?.rendered || "", "text/html")
            const files = Array.from(doc.querySelectorAll("video[src],source[src],a[href]"))
                .map(e => e.getAttribute("src") || e.getAttribute("href") || "")
                .filter(u => /^https:\/\/.+\.(mkv|mp4)(\?|$)/i.test(u))
                // AnimeToki Cloud links carry "?a=view" (its player); the file is the same without it
                .map(u => u.replace(/\?.*$/, ""))
            const title = new DOMParser().parseFromString(p.title?.rendered || "", "text/html").body.textContent || ""
            return { title, link: p.link, files: Array.from(new Set(files)) }
        }))
}

// Runs on the file's own host. Links on AnimeToki Cloud open its player instead of the file: the player looks the file
// up in its folder listing and downloads it by id, so the same is done here. Other hosts serve the link itself.
function tokiFile(href: string) {
    return fetch(href, { headers: { Range: "bytes=0-0" } }).then(async r => {
        r.body?.cancel()
        if (/^video\/|octet-stream|matroska/i.test(r.headers.get("content-type") || "")) return href
        const u = new URL(href), folder = u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1)
        const name = decodeURIComponent(u.pathname.slice(folder.length))
        const list = await fetch(folder + "?a=view", { method: "POST" }).then(r => r.json() as Promise<{ files?: any[] }>).catch(() => null)
        const f = list?.files?.find((x: any) => x?.name === name && typeof x.id === "string")
        if (!f) return "missing"
        const b64 = btoa(Array.from(new TextEncoder().encode(f.name), b => String.fromCharCode(b)).join(""))
        return `${u.origin}/?a=download&id=${encodeURIComponent(f.id)}&name=${encodeURIComponent(b64)}`
    })
}

async function tokiResolve(href: string, signal: AbortSignal, status: (s: string) => void) {
    status("Finding the file")
    const origin = new URL(href).origin
    // A plain file on the host: its player page would send a visitor without a referrer back to AnimeToki
    const url = await withHiddenPage(origin + "/robots.txt", "animetoki",
        page => page.until<string>(`(${tokiFile.toString()})(${JSON.stringify(href)})`, 30000, signal, 2000), [origin])
    if (url === "missing") throw new Error("AnimeToki moved or removed this file")
    return { url: url || href, referer: "https://animetoki.com/" }
}

// Runs inside an AnimeKaizoku series page. Only "Kaizoku" links go straight to a file; the site picks one of
// its file servers at click time and the other hosts pass through a link shortener.
function kaizokuRows() {
    if (location.pathname === "/") return null
    const m = Array.from(document.scripts).map(s => s.textContent?.match(/kzServers\s*=\s*(\[[^\]]*\])/)).find(Boolean)
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a.ddl-link[data-kz-path]"))
    if (!links.length) return document.readyState === "complete" ? { servers: [], rows: [] } : null
    return {
        servers: m ? JSON.parse(m[1]) as string[] : [],
        rows: links.map(a => {
            const row = a.closest("tr")?.textContent || ""
            return {
                path: a.dataset.kzPath || "",
                quality: a.textContent?.trim() || "",
                size: row.match(/[\d.]+\s*[KMGT]B/i)?.[0] || "",
                group: a.closest(".toggle")?.querySelector(".toggle-head")?.textContent?.trim() || "",
            }
        }),
    }
}

async function anidlResolve(fileId: string, signal: AbortSignal, status: (s: string) => void) {
    // The "Get" link leads to AniDL's mirror portal, which copies the file to Pixeldrain on request
    return withHiddenPage(`https://anidl.org/out/file/${fileId}?from=ongoing`, "anidl", async (page: HiddenPage) => {
        status("Opening the mirror page")
        const hash = await page.until<string>("typeof pdHash === 'string' && pdHash", 60000, signal)
        if (!hash) throw new Error("AniDL's mirror page did not open")
        const end = Date.now() + 10 * 60000
        for (; ;) {
            if (signal.aborted) throw new Error("Stopped")
            if (Date.now() > end) throw new Error("The Pixeldrain mirror took too long")
            const state = await page.run<string>(`(() => {
                if (pdCurrentUrl) return "done"
                if (!window.__seanimeAsked && !pdGenBtn.disabled) { window.__seanimeAsked = 1; pdGenBtn.click() }
                const s = document.getElementById("pd-status")?.textContent || ""
                return /error|fail|limit/i.test(s) ? "error:" + s : (document.getElementById("pd-progress-label")?.textContent || "")
            })()`)
            if (state === "done") break
            if (state?.startsWith("error:")) throw new Error(state.slice(6).trim())
            status(`Preparing the Pixeldrain mirror${state && state !== "0%" ? ` ${state}` : ""}`)
            await sleep(2000)
        }
        status("Getting the Pixeldrain link")
        page.load(`https://ddl.ryzenddl.info/out/pixeldrain/beta/${hash}`)
        const end2 = Date.now() + 45000
        while (Date.now() < end2 && !signal.aborted) {
            const id = page.url.match(/^https:\/\/pixeldrain\.com\/u\/([A-Za-z0-9]+)/)?.[1]
            if (id) return { url: `https://pixeldrain.com/api/file/${id}?download`, referer: "https://pixeldrain.com/" }
            await sleep(1000)
        }
        throw new Error("Pixeldrain did not answer")
    })
}

// The three direct-download sites, each listing its files for the anime in Seanime
export const ONLINE_SITES: OnlineSite[] = [
    {
        id: "animetoki", name: "AnimeToki", origin: "https://animetoki.com",
        browseUrl: t => `https://animetoki.com/?s=${encodeURIComponent(t)}`,
        about: "Airing episodes, one file per episode.",
        list: (m, signal) => withHiddenPage("https://animetoki.com/", "animetoki", async page => {
            const out = new Map<string, OnlineFile>()
            for (const q of unique([m.title?.english, m.title?.romaji])) {
                const posts = await page.until<{ title: string, files: string[] }[]>(`(${tokiSearch.toString()})(${JSON.stringify(q)})`, 30000, signal, 2000)
                // The search is loose, so posts are kept only when their title or files name the anime
                const key = alnum(q)
                for (const p of posts ?? []) {
                    for (const f of p.files) {
                        const name = decodeURIComponent(f.split("/").pop() || "")
                        if (!alnum(p.title + decodeURIComponent(f)).includes(key) || out.has(f)) continue
                        out.set(f, {
                            key: f, name, episode: fileEpisode(name) ?? fileEpisode(p.title), quality: fileQuality(name),
                            note: /\bdub|dual/i.test(name) ? "Dub" : undefined,
                            resolve: (signal: AbortSignal, status: (s: string) => void) => tokiResolve(f, signal, status),
                        })
                    }
                }
                if (out.size) break
            }
            return [...out.values()]
        }),
    },
    {
        id: "animekaizoku", name: "AnimeKaizoku", origin: "https://animekaizoku.xyz",
        browseUrl: t => `https://animekaizoku.xyz/?s=${encodeURIComponent(t)}`,
        about: "Finished seasons as one zip per quality.",
        list: (m, signal) => withHiddenPage("https://animekaizoku.xyz/", "animekaizoku", async page => {
            let link: string | undefined
            const keys = queries(m).map(alnum)
            for (const q of queries(m)) {
                const posts = await page.until<{ link: string, title: string }[]>(
                    `fetch('/wp-json/wp/v2/posts?per_page=20&_fields=link,title&search='+encodeURIComponent(${JSON.stringify(q)})).then(r=>r.json()).then(p=>p.map(x=>({link:x.link,title:new DOMParser().parseFromString(x.title.rendered,'text/html').body.textContent})))`,
                    30000, signal, 2000)
                // Series addresses end in the MyAnimeList id
                link = posts?.find(p => m.idMal && new RegExp(`-${m.idMal}/?$`).test(p.link))?.link
                    ?? posts?.find(p => keys.includes(alnum(p.title)))?.link
                if (link) break
            }
            if (!link) return []
            page.load(link)
            const found = await page.until<ReturnType<typeof kaizokuRows>>(`(${kaizokuRows.toString()})()`, 45000, signal, 1500)
            const servers = found?.servers?.length ? found.servers : ["https://drive-index.bgtoons.workers.dev"]
            return (found?.rows ?? []).filter(r => r.path.startsWith("file/")).map(r => ({
                key: r.path,
                name: `${m.title?.userPreferred || m.title?.romaji} ${r.quality}.zip`,
                quality: r.quality.toLowerCase(),
                size: r.size,
                note: [r.group, "Whole season"].filter(Boolean).join(" · "),
                resolve: async () => ({
                    url: `${servers[Math.floor(Math.random() * servers.length)]}/download/${r.path.slice("file/".length)}`,
                    referer: link,
                }),
            }))
        }),
    },
    {
        id: "anidl", name: "AniDL", origin: "https://anidl.org",
        browseUrl: () => "https://anidl.org/on-going",
        about: "Airing episodes, mirrored to Pixeldrain when you download (can take a minute).",
        adsAllowed: true,
        list: (m, signal) => withHiddenPage("https://anidl.org/on-going", "anidl", async page => {
            for (const q of queries(m)) {
                const files = await page.until<any[]>(
                    `fetch('/api/on_air_data?page=1&limit=100&sortField=date&sortOrder=desc&search='+encodeURIComponent(${JSON.stringify(q)})).then(r=>r.ok?r.json():null).then(j=>j&&j.files)`,
                    30000, signal, 2000)
                const mine = (files ?? []).filter(f => f?.anilist_id === m.id && typeof f.id === "string" && typeof f.filename === "string")
                if (!mine.length) continue
                return mine.map(f => ({
                    key: f.id,
                    name: f.filename,
                    episode: fileEpisode(f.filename),
                    quality: fileQuality(f.filename),
                    size: String(f.size || "").replace(/MBs/, "MB"),
                    note: Array.isArray(f.audio) && f.audio.length > 1 ? "Dual audio" : undefined,
                    resolve: (signal: AbortSignal, status: (s: string) => void) => anidlResolve(f.id, signal, status),
                }))
            }
            return []
        }),
    },
]

/**
 * Follows the site's steps to the file and hands it to the desktop app. It keeps going when the drawer closes;
 * until the app has it, it is listed as being prepared.
 */
export async function startOnlineDownload(site: OnlineSite, file: OnlineFile, to: { title: string, mediaId: number, dir?: string }) {
    const key = site.id + ":" + file.key
    const base = { key, name: file.name, title: to.title, mediaId: to.mediaId, sourceId: site.id, started: Date.now() }
    setPreparing(key, { ...base, status: "Starting" })
    try {
        const { url, referer } = await file.resolve(new AbortController().signal, status => setPreparing(key, { ...base, status }))
        sendDownloadAction("start", { sourceId: site.id, url, referer, dir: to.dir, title: to.title, mediaId: to.mediaId })
        setPreparing(key, undefined)
        return true
    }
    catch (e: any) {
        setPreparing(key, { ...base, status: "Failed", error: e?.message || "The site did not give the file" })
        return false
    }
}
