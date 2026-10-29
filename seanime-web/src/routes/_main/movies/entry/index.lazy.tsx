import Page from "@/app/(main)/movies/entry/page"
import { createLazyFileRoute } from "@tanstack/react-router"

export const Route = createLazyFileRoute("/_main/movies/entry/")({
    component: Page,
})
