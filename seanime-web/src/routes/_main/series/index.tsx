import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

const searchSchema = z.object({
    tab: z.enum(["discover", "browse", "list"]).optional(),
    q: z.string().optional(),
})

export const Route = createFileRoute("/_main/series/")({
    validateSearch: searchSchema,
})
