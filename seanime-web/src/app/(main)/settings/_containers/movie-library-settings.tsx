import { moveMoviesToLibrary, setMovieLibraryDir, useMovieSettings } from "@/app/(main)/movies/_lib/movies.api"
import { SettingsCard } from "@/app/(main)/settings/_components/settings-card"
import { DirectorySelector } from "@/components/shared/directory-selector"
import { Button } from "@/components/ui/button"
import { useQueryClient } from "@tanstack/react-query"
import React from "react"
import { FcFolder } from "react-icons/fc"
import { toast } from "sonner"

/** Where movie downloads go, kept by the movie torrent engine rather than the anime settings form. */
export function MovieLibrarySettings() {
    const queryClient = useQueryClient()
    const [poll, setPoll] = React.useState(false)
    const { data: settings, isError, refetch } = useMovieSettings(poll ? 1000 : false)
    const [dir, setDir] = React.useState("")
    const [saving, setSaving] = React.useState(false)

    React.useEffect(() => {
        if (settings && !dir) setDir(settings.custom ? settings.libraryDir : "")
    }, [settings])

    const moving = settings?.moving && !settings.moving.done ? settings.moving : undefined
    React.useEffect(() => {
        if (poll && settings?.moving?.done) {
            setPoll(false)
            queryClient.invalidateQueries({ queryKey: ["movies-library"] })
            if (settings.moving.error) toast.error(settings.moving.error)
            else toast.success(`Moved ${settings.moving.moved} ${settings.moving.moved === 1 ? "movie" : "movies"} to the movie library`)
        }
    }, [poll, settings?.moving?.done])

    async function save() {
        setSaving(true)
        try {
            await setMovieLibraryDir(dir.trim())
            toast.success("Movie library folder saved")
            await refetch()
        }
        catch (e: any) {
            toast.error(e?.message ?? "Could not save the folder")
        }
        finally {
            setSaving(false)
        }
    }

    async function move() {
        try {
            await moveMoviesToLibrary()
            setPoll(true)
            refetch()
        }
        catch (e: any) {
            toast.error(e?.message ?? "Could not move the movies")
        }
    }

    const changed = !!settings && dir.trim() !== (settings.custom ? settings.libraryDir : "")

    return (
        <SettingsCard title="Movie library" description="Downloaded movies are saved here, from the built-in downloader and from your torrent client.">
            {isError ? <p className="text-[--muted]">The movie engine is not running. Restart Seanime and try again.</p> : <>
                <DirectorySelector
                    label="Movie library directory"
                    leftIcon={<FcFolder />}
                    value={dir}
                    onSelect={setDir}
                    help={settings && !dir ? `Not set, movies are saved in ${settings.defaultDir}` : undefined}
                />
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" intent="white" size="sm" loading={saving} disabled={!changed || !!moving} onClick={save}>
                        Save folder
                    </Button>
                    {!!moving && <p className="text-sm text-[--muted]">Moving movies… {moving.moved}/{moving.total}</p>}
                </div>
                {!moving && !changed && !!settings?.outside && <div className="rounded-[--radius-md] border p-3 flex flex-wrap items-center gap-3">
                    <p className="flex-1 text-sm">
                        {settings.outside} downloaded {settings.outside === 1 ? "movie is" : "movies are"} in another folder. Move {settings.outside === 1
                        ? "it"
                        : "them"} to {settings.libraryDir}?
                    </p>
                    <Button type="button" size="sm" intent="primary" onClick={move}>Move</Button>
                </div>}
            </>}
        </SettingsCard>
    )
}
