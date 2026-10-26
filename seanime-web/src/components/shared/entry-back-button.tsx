import type { AnyRouter } from "@tanstack/react-router"

export function EntryBackButton() {
    return <div data-entry-back-navigation>
        <button type="button" data-entry-back-button aria-label="Go back" title="Go back" onClick={() => window.SeanimeNavigation?.back()}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 19-7-7 7-7M5 12h14" />
            </svg>
        </button>
    </div>
}

declare global {
    interface Window {
        SeanimeNavigation?: {
            connectRouter(router: AnyRouter): void
            setSearchParams(params: unknown): void
            restoreSearch<T>(): T | null
            back(): void
        }
    }
}
