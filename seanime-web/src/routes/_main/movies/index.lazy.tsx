import Page from "@/app/(main)/movies/page"
import { createLazyFileRoute } from "@tanstack/react-router"

export const Route = createLazyFileRoute("/_main/movies/")({
    component: Page,
})
