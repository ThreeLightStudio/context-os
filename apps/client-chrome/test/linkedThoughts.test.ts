import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterLinkedThoughtsForUrl, LinkedThoughtsLoader, type LinkedThoughtsLoadResult } from '../src/linkedThoughts'

function capture(id: string) {
  return {
    id,
    recordedAt: '2026-08-14T00:00:00.000Z',
    receivedAt: '2026-08-14T00:00:01.000Z',
    data: { kind: 'capture' as const, content: id, source: { client: 'chrome' } }
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => vi.useRealTimers())

describe('LinkedThoughtsLoader', () => {
  it('keeps exact URL matching when an older Worker returns unfiltered records', () => {
    const currentUrl = 'https://example.test/current'
    const captures = [
      { ...capture('matching'), data: { ...capture('matching').data, context: { browser: { url: currentUrl } } } },
      { ...capture('other'), data: { ...capture('other').data, context: { browser: { url: 'https://example.test/other' } } } }
    ]

    expect(filterLinkedThoughtsForUrl(captures, currentUrl).map((item) => item.id)).toEqual(['matching'])
  })

  it('debounces rapid tab changes into one request for the final URL', async () => {
    vi.useFakeTimers()
    const loader = new LinkedThoughtsLoader()
    const fetcher = vi.fn(async (url: string): Promise<LinkedThoughtsLoadResult> => ({ ok: true, captures: [capture(url)] }))
    const visible: string[] = []

    loader.load('https://first.test', fetcher, (captures) => visible.push(captures[0]?.id ?? 'empty'))
    loader.load('https://second.test', fetcher, (captures) => visible.push(captures[0]?.id ?? 'empty'))
    vi.advanceTimersByTime(350)
    await flushPromises()

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://second.test', expect.any(AbortSignal))
    expect(visible).toEqual(['https://second.test'])
  })

  it('aborts and ignores a stale response after a newer URL is selected', async () => {
    vi.useFakeTimers()
    const loader = new LinkedThoughtsLoader()
    const resolvers = new Map<string, (result: LinkedThoughtsLoadResult) => void>()
    const fetcher = vi.fn((url: string) => new Promise<LinkedThoughtsLoadResult>((resolve) => resolvers.set(url, resolve)))
    const visible: string[] = []

    loader.load('https://old.test', fetcher, (captures) => visible.push(captures[0]?.id ?? 'empty'))
    vi.advanceTimersByTime(350)
    const oldSignal = fetcher.mock.calls[0][1] as AbortSignal

    loader.load('https://new.test', fetcher, (captures) => visible.push(captures[0]?.id ?? 'empty'))
    expect(oldSignal.aborted).toBe(true)
    vi.advanceTimersByTime(350)

    resolvers.get('https://new.test')?.({ ok: true, captures: [capture('new')] })
    await flushPromises()
    resolvers.get('https://old.test')?.({ ok: true, captures: [capture('old')] })
    await flushPromises()

    expect(visible).toEqual(['new'])
  })

  it('reuses successful entries until expiry and refetches after invalidation or reset', async () => {
    vi.useFakeTimers()
    let now = 0
    const loader = new LinkedThoughtsLoader({ debounceMs: 1, cacheTtlMs: 30_000, now: () => now })
    const fetcher = vi.fn(async (url: string): Promise<LinkedThoughtsLoadResult> => ({ ok: true, captures: [capture(url)] }))
    const visible: string[] = []
    const load = () => loader.load('https://cached.test', fetcher, (captures) => visible.push(captures[0]?.id ?? 'empty'))

    load()
    vi.advanceTimersByTime(1)
    await flushPromises()
    load()
    expect(fetcher).toHaveBeenCalledTimes(1)

    loader.invalidate('https://cached.test')
    load()
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(fetcher).toHaveBeenCalledTimes(2)

    loader.reset()
    load()
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(fetcher).toHaveBeenCalledTimes(3)

    now += 30_001
    load()
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(visible).toEqual(['https://cached.test', 'https://cached.test', 'https://cached.test', 'https://cached.test', 'https://cached.test'])
  })

  it('does not cache failed lookups', async () => {
    vi.useFakeTimers()
    const loader = new LinkedThoughtsLoader({ debounceMs: 1 })
    const fetcher = vi.fn(async (): Promise<LinkedThoughtsLoadResult> => ({ ok: false }))

    loader.load('https://failed.test', fetcher, () => {})
    vi.advanceTimersByTime(1)
    await flushPromises()
    loader.load('https://failed.test', fetcher, () => {})
    vi.advanceTimersByTime(1)
    await flushPromises()

    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
