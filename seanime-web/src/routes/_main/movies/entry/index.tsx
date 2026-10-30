import { MediaEntryPageLoadingDisplay } from "@/app/(main)/_features/media/_components/media-entry-page-loading-display"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

const searchSchema = z.object({
    id: z.coerce.string().optional(),
})

export const Route = createFileRoute("/_main/movies/entry/")({
    validateSearch: searchSchema,
    pendingComponent: MediaEntryPageLoadingDisplay,
    pendingMs: 0,
})
