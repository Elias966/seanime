import Page from "@/app/(main)/online-downloads/page"
import { createLazyFileRoute } from "@tanstack/react-router"

export const Route = createLazyFileRoute("/_main/online-downloads/")({
    component: Page,
})
