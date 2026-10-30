import Page from "@/app/(main)/series/page"
import { createLazyFileRoute } from "@tanstack/react-router"

export const Route = createLazyFileRoute("/_main/series/")({
    component: Page,
})
