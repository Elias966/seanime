import { movieLink, useMovieSettings, useSetMovieHidden } from "@/app/(main)/movies/_lib/movies.api"
import { SettingsCard } from "@/app/(main)/settings/_components/settings-card"
import { SeaLink } from "@/components/shared/sea-link"
import { Button } from "@/components/ui/button"
import React from "react"
import { toast } from "sonner"

/** Movies hidden with the button on movie cards, they come back in the catalogs once shown again. */
export function HiddenMoviesSettings() {
    const { data: settings, isError, isLoading } = useMovieSettings()
    const { mutate, isPending, variables } = useSetMovieHidden()
    const hidden = settings?.hidden ?? []

    return (
        <SettingsCard title="Hidden movies" description="Movies you hid from the movie pages. Show one again to see it in the catalogs.">
            {isError ? <p className="text-[--muted]">The movie engine is not running. Restart Seanime and try again.</p>
                : isLoading ? null
                    : !hidden.length ? <p className="text-[--muted]">No hidden movies. Use the hide button on a movie card to hide one.</p>
                        : <div className="divide-y">
                            {hidden.map(item => (
                                <div key={item.id} className="flex items-center gap-3 py-2" data-hidden-movie={item.id}>
                                    {item.poster
                                        ? <img src={item.poster} alt="" className="w-10 h-14 object-cover rounded-[--radius-md] flex-none" loading="lazy" />
                                        : <div className="w-10 h-14 rounded-[--radius-md] bg-gray-800 flex-none" />}
                                    <div className="flex-1 min-w-0">
                                        <SeaLink href={movieLink(item.id)} className="font-medium truncate block hover:underline">
                                            {item.name || item.id}
                                        </SeaLink>
                                        {!!item.year && <p className="text-xs text-[--muted]">{item.year}</p>}
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        intent="gray-subtle"
                                        loading={isPending && variables?.meta.id === item.id}
                                        onClick={() => mutate({ meta: { id: item.id, name: item.name }, hidden: false }, {
                                            onError: (e: any) => toast.error(e?.message ?? "Could not show the movie"),
                                        })}
                                    >
                                        Show again
                                    </Button>
                                </div>
                            ))}
                        </div>}
        </SettingsCard>
    )
}
