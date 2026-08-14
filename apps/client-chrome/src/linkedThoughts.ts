import type { RemoteCapture } from './contextCapture'

export const LINKED_THOUGHTS_DEBOUNCE_MS = 350
export const LINKED_THOUGHTS_CACHE_TTL_MS = 30_000
export const LINKED_THOUGHTS_CACHE_MAX_ENTRIES = 50

export type LinkedThoughtsLoadResult =
  | { ok: true; captures: RemoteCapture[] }
  | { ok: false }

export type LinkedThoughtsFetcher = (url: string, signal: AbortSignal) => Promise<LinkedThoughtsLoadResult>

/** Keeps URL matching correct while an older Worker ignores the optional url parameter. */
export function filterLinkedThoughtsForUrl(captures: RemoteCapture[], url: string) {
  return captures.filter((capture) => capture.data.context?.browser?.url === url)
}

type CacheEntry = {
  expiresAt: number
  captures: RemoteCapture[]
}

type LinkedThoughtsLoaderOptions = {
  debounceMs?: number
  cacheTtlMs?: number
  maxEntries?: number
  now?: () => number
}

/** Coordinates one surface's linked-thought lookup without persisting capture data. */
export class LinkedThoughtsLoader {
  private readonly debounceMs: number
  private readonly cacheTtlMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly cache = new Map<string, CacheEntry>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private controller: AbortController | undefined
  private requestId = 0

  constructor(options: LinkedThoughtsLoaderOptions = {}) {
    this.debounceMs = options.debounceMs ?? LINKED_THOUGHTS_DEBOUNCE_MS
    this.cacheTtlMs = options.cacheTtlMs ?? LINKED_THOUGHTS_CACHE_TTL_MS
    this.maxEntries = options.maxEntries ?? LINKED_THOUGHTS_CACHE_MAX_ENTRIES
    this.now = options.now ?? Date.now
  }

  load(url: string, fetcher: LinkedThoughtsFetcher, onResult: (captures: RemoteCapture[]) => void) {
    const requestId = this.startRequest()
    const cached = this.getCached(url)
    if (cached) {
      onResult(cached)
      return
    }

    this.timer = setTimeout(() => {
      this.timer = undefined
      const controller = new AbortController()
      this.controller = controller
      void fetcher(url, controller.signal)
        .then((result) => {
          if (!this.isCurrent(requestId, controller)) return
          if (result.ok) this.setCached(url, result.captures)
          onResult(result.ok ? result.captures : [])
        })
        .catch(() => {
          if (this.isCurrent(requestId, controller)) onResult([])
        })
        .finally(() => {
          if (this.controller === controller) this.controller = undefined
        })
    }, this.debounceMs)
  }

  cancel() {
    this.startRequest()
  }

  invalidate(url: string | undefined) {
    if (url) this.cache.delete(url)
  }

  reset() {
    this.cancel()
    this.cache.clear()
  }

  private startRequest() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.controller?.abort()
    this.controller = undefined
    this.requestId += 1
    return this.requestId
  }

  private isCurrent(requestId: number, controller: AbortController) {
    return requestId === this.requestId && !controller.signal.aborted
  }

  private getCached(url: string) {
    const cached = this.cache.get(url)
    if (!cached) return undefined
    if (cached.expiresAt <= this.now()) {
      this.cache.delete(url)
      return undefined
    }

    // Move an entry to the end so the map remains least-recently-used.
    this.cache.delete(url)
    this.cache.set(url, cached)
    return cached.captures
  }

  private setCached(url: string, captures: RemoteCapture[]) {
    this.cache.delete(url)
    this.cache.set(url, { captures, expiresAt: this.now() + this.cacheTtlMs })
    while (this.cache.size > this.maxEntries) {
      const oldestUrl = this.cache.keys().next().value
      if (oldestUrl === undefined) break
      this.cache.delete(oldestUrl)
    }
  }
}
