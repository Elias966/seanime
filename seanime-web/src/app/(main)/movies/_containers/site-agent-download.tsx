import { formatBytes, MEDIA_HELPER } from "@/app/(main)/movies/_lib/movies.api"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { ProgressBar } from "@/components/ui/progress-bar"
import { useQuery } from "@tanstack/react-query"
import React from "react"
import { BiDownload, BiLinkExternal, BiX } from "react-icons/bi"
import { toast } from "sonner"

type AgentSource = { id: string, name: string, kinds: string[], categories: string[], mode: string, accountRequired?: boolean, excluded?: boolean }
type AgentItem = { season: number | null, episode: number | null, state: string, detail: string, file: string | null, done: number, size: number }
type AgentJob = { id: string, source: string, site: string, kind: string, title: string, dir: string, state: string, items: AgentItem[] }

async function agentPost(path: string, body: unknown) {
    const res = await fetch(`${MEDIA_HELPER}/media/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error ?? "The download could not start")
    return data
}

const STATE_TEXT: Record<string, string> = { queued: "Waiting", searching: "AI is searching", human: "Needs you in Firefox", downloading: "Downloading", done: "Saved", failed: "Failed", cancelled: "Cancelled" }

/** Pick what to get and from which site; the local AI searches the site and downloads it. */
export function SiteAgentDownload({ kind, title, year, dir, season, episodes }: {
    kind: "movie" | "series" | "anime"
    title: string
    year?: string | number
    dir: string
    season?: number
    /** Episode numbers to choose from, none for a movie */
    episodes?: number[]
}) {
    const [picked, setPicked] = React.useState<Set<number>>(new Set())
    React.useEffect(() => setPicked(new Set(episodes ?? [])), [episodes?.join(",")])

    const { data: sources, isLoading } = useQuery({
        queryKey: ["site-agent-sources", kind],
        queryFn: async () => {
            const data = await (await fetch(`${MEDIA_HELPER}/media/source-registry`)).json() as { sources: AgentSource[] }
            const want = kind === "anime" ? "anime" : "movies"
            const rank = (s: AgentSource) => s.categories.includes("direct-download") ? 0 : 1
            return data.sources
                .filter(s => (s.mode === "site" || s.mode === "firefox") && !s.excluded && !s.accountRequired && s.kinds.includes(want) && !s.categories.includes("torrent"))
                .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
        },
    })
    const { data: jobs, refetch } = useQuery({
        queryKey: ["site-agent-jobs"],
        queryFn: async () => (await (await fetch(`${MEDIA_HELPER}/media/agent-jobs`)).json()) as AgentJob[],
        refetchInterval: 2000,
    })
    const mine = (jobs ?? []).filter(j => j.title === title && j.kind === kind).reverse()

    const start = (site: AgentSource) => {
        const list = episodes ? [...picked].sort((a, b) => a - b) : undefined
        if (episodes && !list!.length) return toast.error("Pick at least one episode")
        if (!dir) return toast.error("Choose a download folder in Settings first")
        agentPost("agent-start", { id: site.id, kind, title, year, dir, season, episodes: list })
            .then(() => refetch())
            .catch((e: any) => toast.error(e.message))
    }

    return (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4" data-site-agent>
            {!!episodes?.length && <div className="space-y-2" data-site-agent-episodes>
                <div className="flex items-center gap-2">
                    <span className="font-medium">Episodes{season ? ` of season ${season}` : ""}</span>
                    <span className="text-sm text-[--muted]">{picked.size} of {episodes.length}</span>
                    <div className="flex-1" />
                    <Button size="sm" intent="gray-subtle" onClick={() => setPicked(new Set(episodes))} data-site-agent-all>All episodes</Button>
                    <Button size="sm" intent="gray-subtle" onClick={() => setPicked(new Set())}>None</Button>
                </div>
                <div className="flex flex-wrap gap-1">
                    {episodes.map(e => <button
                        key={e}
                        className={`w-10 h-8 rounded-md border text-sm ${picked.has(e) ? "bg-white text-black" : "bg-gray-900"}`}
                        onClick={() => setPicked(p => {
                            const next = new Set(p)
                            if (!next.delete(e)) next.add(e)
                            return next
                        })}
                        data-site-agent-episode={e}
                    >{e}</button>)}
                </div>
            </div>}

            {!!mine.length && <div className="space-y-2" data-site-agent-jobs>
                {mine.map(job => <AgentJobRow key={job.id} job={job} onChange={() => refetch()} />)}
            </div>}

            <div className="space-y-2">
                <p className="text-sm text-[--muted]">
                    Choose a website. The local AI searches it and downloads for you, then leaves the GPU. If a site asks for a human check, Firefox comes up for you and hides again.
                </p>
                {isLoading ? <div className="flex justify-center py-6"><LoadingSpinner /></div> : (sources ?? []).map(site =>
                    <div key={site.id} className="flex items-center gap-3 rounded-md border p-3">
                        <span className="font-medium">{site.name}</span>
                        <span className="text-xs text-[--muted] flex-1">
                            {site.categories.includes("direct-download") ? "Direct download" : "Streaming site"}{site.mode === "firefox" ? " · may ask for a human check" : ""}
                        </span>
                        <Button size="sm" intent="white" leftIcon={<BiDownload />} onClick={() => start(site)} data-site-agent-site={site.id}>Download</Button>
                    </div>)}
            </div>
        </div>
    )
}

function AgentJobRow({ job, onChange }: { job: AgentJob, onChange: () => void }) {
    const active = job.state === "queued" || job.state === "running"
    return (
        <div className="rounded-md border p-3 space-y-2" data-site-agent-job={job.state}>
            <div className="flex items-center gap-2">
                <span className="font-medium flex-1 truncate">{job.site}</span>
                {!active && job.state !== "done" && <Button size="sm" intent="gray-subtle" leftIcon={<BiLinkExternal />}
                    onClick={() => window.SeanimeMediaHub?.browse?.(job.source)}>Open site</Button>}
                {active && <Button size="sm" intent="alert-subtle" leftIcon={<BiX />}
                    onClick={() => agentPost("agent-cancel", { id: job.id }).then(onChange).catch((e: any) => toast.error(e.message))}>Cancel</Button>}
            </div>
            {job.items.map((item, i) => <div key={i} className="text-sm space-y-1">
                <div className="flex gap-2">
                    {item.episode !== null && <span className="w-20 shrink-0">Episode {item.episode}</span>}
                    <span className="shrink-0">{STATE_TEXT[item.state] ?? item.state}</span>
                    <span className="text-[--muted] truncate">{item.state === "downloading" && item.size ? `${formatBytes(item.done)} of ${formatBytes(item.size)}` : item.detail}</span>
                </div>
                {item.state === "downloading" && item.size > 0 && <ProgressBar size="sm" value={item.done / item.size * 100} />}
            </div>)}
        </div>
    )
}
