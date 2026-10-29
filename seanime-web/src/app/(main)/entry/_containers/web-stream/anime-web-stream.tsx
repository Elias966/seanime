import { Anime_Entry } from "@/api/generated/types"
import { OnlineStreamModal, readLastSource } from "@/app/(main)/movies/_containers/online-stream-modal"
import { findPageLink, Movie_StreamRef, Movie_StreamSource } from "@/app/(main)/movies/_lib/movies.api"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { NumberInput } from "@/components/ui/number-input"
import { StaticTabs } from "@/components/ui/tabs"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { BiPlay } from "react-icons/bi"
import { FiGlobe } from "react-icons/fi"
import { PiMonitorPlayDuotone } from "react-icons/pi"

export const __animeWebStream_openAtom = atom(false)

const LAST_SOURCE_KEY = "seanime-anime-last-stream-source"

type Audio = "sub" | "dub"
type AnimeRef = { anilistId: number, malId?: number, romaji: string, english: string, episode: number, audio: Audio }

type AnimeStreamSite = {
    id: string
    name: string
    host: string
    /** Registry source the hidden page runs as (its partition and media relay) */
    sourceId: string
    audio: Audio[]
    url?: (a: AnimeRef) => string | undefined
    resolve?: (a: AnimeRef, signal: AbortSignal) => Promise<string | undefined>
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-")
// Sites spell punctuation differently in addresses ("journeys" / "journey-s"), so titles are compared by letters and digits only
const alnum = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "")
const titleKeys = (a: AnimeRef) => [a.romaji, a.english].filter(Boolean).map(alnum)

/** Websites whose player hands Seanime a playable stream for one episode, used in this order by Play. */
const SITES: AnimeStreamSite[] = [
    {
        id: "miruro", name: "Miruro", host: "miruro.tv", sourceId: "miruro", audio: ["sub"],
        // Miruro's addresses use its own ids, so the series is found through its search
        resolve: async (a, signal) => {
            const want = [slug(a.romaji), slug(a.english)].filter(Boolean)
            const page = await findPageLink(`https://www.miruro.tv/search?query=${encodeURIComponent(a.romaji || a.english)}`, "miruro", links => {
                const watch = links.filter(l => /^https:\/\/www\.miruro\.tv\/watch\/[^/]+\/[^/?#]+$/.test(l.href))
                return watch.find(l => want.includes(l.href.split("/").pop()!))?.href
                    ?? watch.find(l => [a.romaji, a.english].some(t => t && l.text.toLowerCase() === t.toLowerCase()))?.href
            }, signal)
            return page && `${page}?ep=${a.episode}`
        },
    },
    {
        id: "vidnest", name: "Vidnest", host: "vidnest.fun", sourceId: "bingeflix", audio: ["sub", "dub"],
        url: a => `https://vidnest.fun/anime/${a.anilistId}/${a.episode}/${a.audio}`,
    },
    {
        id: "allwish", name: "All-Wish", host: "all-wish.me", sourceId: "allwish", audio: ["sub"],
        // Series addresses end in an id of the site's own, some with "-tv" before it: /watch/<title>[-tv]-<id>/ep-<n>
        resolve: async (a, signal) => {
            const want = titleKeys(a)
            const page = await findPageLink(`https://all-wish.me/filter?keyword=${encodeURIComponent(a.romaji || a.english)}`, "allwish", links =>
                links.map(l => l.href.match(/^https:\/\/all-wish\.me\/watch\/([^/?#]+?)(?:-tv)?-[a-z0-9]{5}(?=\/|$)/))
                    .find(m => m && want.includes(alnum(m[1])))?.[0], signal)
            return page && `${page}/ep-${a.episode}`
        },
    },
    {
        id: "animeparadise", name: "AnimeParadise", host: "animeparadise.moe", sourceId: "animeparadise", audio: ["sub"],
        // Episodes have random ids, so the series page is found through the search and the episode is picked from its list
        resolve: async (a, signal) => {
            const want = titleKeys(a)
            const series = await findPageLink(`https://www.animeparadise.moe/search?q=${encodeURIComponent(a.romaji || a.english)}`, "animeparadise",
                links => links.find(l => /^https:\/\/www\.animeparadise\.moe\/anime\/[^/?#]+$/.test(l.href) && want.includes(alnum(l.href.split("/").pop()!)))?.href,
                signal)
            // An episode link reads "<episode title> <number> <views>"
            return series && findPageLink(series, "animeparadise", links => links.find(l => l.href.includes("/watch/")
                && l.text.replace(/\s+/g, " ").match(/(\d+) \d+$/)?.[1] === String(a.episode))?.href, signal)
        },
    },
]

function toStreamSource(site: AnimeStreamSite, a: AnimeRef): Movie_StreamSource {
    return {
        id: site.id,
        name: site.name,
        sourceId: site.sourceId,
        url: () => site.url?.(a),
        resolve: site.resolve && (async (_, signal) => site.resolve!(a, signal)),
        timeout: 40000,
    }
}

export function AnimeWebStreamButton() {
    const [, setOpen] = useAtom(__animeWebStream_openAtom)
    return (
        <Button intent="gray-subtle" size="md" leftIcon={<FiGlobe className="text-xl" />} onClick={() => setOpen(true)} data-anime-web-stream-button>
            Web streaming
        </Button>
    )
}

export function AnimeWebStreamModal({ entry }: { entry: Anime_Entry }) {
    const [open, setOpen] = useAtom(__animeWebStream_openAtom)
    const media = entry.media
    const aired = media?.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : undefined
    const total = media?.episodes || aired || 0
    const [episode, setEpisode] = React.useState(1)
    const [audio, setAudio] = React.useState<Audio>("sub")
    const [streaming, setStreaming] = React.useState<{ sources: Movie_StreamSource[], key: number }>()

    // Opens on the next episode to watch
    React.useEffect(() => {
        if (!open) return
        const next = (entry.listData?.progress ?? 0) + 1
        setEpisode(total ? Math.min(next, total) : next)
    }, [open])

    if (!media) return null
    const ref: AnimeRef = {
        anilistId: media.id, malId: media.idMal, romaji: media.title?.romaji || "", english: media.title?.english || "",
        episode, audio,
    }
    const title = media.title?.userPreferred || ref.romaji || ref.english
    const streamRef: Movie_StreamRef = { title: `${title} - Episode ${episode}` }
    const available = SITES.filter(s => s.audio.includes(audio))
    const play = (sites: AnimeStreamSite[]) => setStreaming({ sources: sites.map(s => toStreamSource(s, ref)), key: Date.now() })
    // The website that played last time is tried first, it is the most likely to work again
    const playAll = () => {
        const last = readLastSource(LAST_SOURCE_KEY)
        play([...available].sort((a, b) => Number(b.id === last) - Number(a.id === last)))
    }

    return (
        <>
            <Modal open={open} onOpenChange={setOpen} title="Web streaming" contentClass="max-w-3xl">
                <div className="space-y-4" data-anime-web-stream>
                    <p className="text-sm text-[--muted]">
                        Plays the episode from a streaming website in the Seanime player. Play tries the websites one by one, starting with the one that worked last.
                    </p>
                    <div className="flex items-end gap-3 flex-wrap">
                        <NumberInput
                            label="Episode"
                            value={episode}
                            min={1}
                            max={total || undefined}
                            onValueChange={v => setEpisode(Math.max(1, Math.round(v || 1)))}
                            fieldClass="w-36"
                            data-anime-web-stream-episode
                        />
                        <StaticTabs
                            className="h-10 w-fit border rounded-full"
                            triggerClass="px-4 py-1"
                            items={(["sub", "dub"] as Audio[]).map(a => ({
                                name: a === "sub" ? "Subbed" : "Dubbed", isCurrent: audio === a, onClick: () => setAudio(a),
                            }))}
                        />
                        <div className="flex-1" />
                        <Button intent="white" className="rounded-full" leftIcon={<BiPlay className="text-2xl" />} disabled={!available.length}
                            onClick={playAll}>
                            Play episode {episode}
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {SITES.map(site => {
                            const enabled = site.audio.includes(audio)
                            return (
                                <button
                                    key={site.id}
                                    type="button"
                                    disabled={!enabled}
                                    data-anime-stream-source={site.id}
                                    className="border rounded-[--radius-md] bg-[--paper] px-4 py-3 flex items-center gap-3 text-left transition-colors hover:border-[--brand] disabled:opacity-40 disabled:hover:border-[--border]"
                                    onClick={() => play([site])}
                                >
                                    <PiMonitorPlayDuotone className="text-2xl flex-none text-[--muted]" />
                                    <span className="flex-1 min-w-0">
                                        <span className="block font-medium truncate">{site.name}</span>
                                        <span className="block text-xs text-[--muted] truncate">{enabled ? site.host : "No dub"}</span>
                                    </span>
                                    <BiPlay className="text-2xl flex-none" />
                                </button>
                            )
                        })}
                    </div>
                </div>
            </Modal>

            <OnlineStreamModal
                streaming={streaming}
                ref_={streamRef}
                onClose={() => setStreaming(undefined)}
                onTryAll={playAll}
                lastSourceKey={LAST_SOURCE_KEY}
            />
        </>
    )
}
