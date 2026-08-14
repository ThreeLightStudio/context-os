import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkContextServerConnection, listRemoteCaptures } from '../src/contextCapture'

function capture(id: string) {
  return {
    id,
    recordedAt: '2026-07-25T02:00:00.000Z',
    receivedAt: '2026-07-25T02:00:01.000Z',
    data: { kind: 'capture' as const, content: `생각 ${id}`, source: { client: 'chrome' } }
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('listRemoteCaptures', () => {
  it('loads every offset page instead of stopping at the server page limit', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => capture(`first-${index}`))
    const secondPage = Array.from({ length: 100 }, (_, index) => capture(`second-${index}`))
    const finalPage = [capture('final')]
    const requests: string[] = []

    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input)
      requests.push(`${url.searchParams.get('limit')}:${url.searchParams.get('offset') ?? ''}`)
      const offset = url.searchParams.get('offset')
      const records = offset === '100' ? secondPage : offset === '200' ? finalPage : firstPage
      return new Response(JSON.stringify({ records }), { status: 200 })
    }))

    await expect(listRemoteCaptures({ endpointUrl: 'http://context.test', apiToken: 'test-token' })).resolves.toMatchObject({
      ok: true,
      captures: expect.arrayContaining([expect.objectContaining({ id: 'first-0' }), expect.objectContaining({ id: 'second-0' }), expect.objectContaining({ id: 'final' })])
    })
    expect(requests).toEqual(['100:', '100:100', '100:200'])
  })

  it('follows cursor pagination when the server provides it', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => capture(`first-${index}`))
    const finalPage = [capture('final')]
    const requests: string[] = []

    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input)
      requests.push(url.searchParams.get('cursor') ?? '')
      return new Response(JSON.stringify(
        url.searchParams.get('cursor') === 'page-2'
          ? { records: finalPage, nextCursor: null }
          : { records: firstPage, nextCursor: 'page-2' }
      ), { status: 200 })
    }))

    const result = await listRemoteCaptures({ endpointUrl: 'http://context.test', apiToken: 'test-token' })
    expect(result).toMatchObject({ ok: true, captures: expect.arrayContaining([expect.objectContaining({ id: 'final' })]) })
    expect(requests).toEqual(['', 'page-2'])
  })

  it('sends the configured API token without exposing it in the request URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ records: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRemoteCaptures({ endpointUrl: 'https://context.test/', apiToken: 'test-token' })).resolves.toEqual({ ok: true, captures: [] })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://context.test/v1/records?limit=100',
      expect.objectContaining({ headers: expect.any(Headers) })
    )
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(requestInit.headers).get('authorization')).toBe('Bearer test-token')
    expect(fetchMock.mock.calls[0][0]).not.toContain('test-token')
  })

  it('does not make unauthenticated requests when the token is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRemoteCaptures({ endpointUrl: 'https://context.test', apiToken: '' })).resolves.toEqual({
      ok: false,
      error: 'Context Server API token is not configured.'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('checkContextServerConnection', () => {
  it('checks one authenticated record without loading the full history', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ records: [], nextCursor: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(checkContextServerConnection({ endpointUrl: 'http://127.0.0.1:8787/', apiToken: 'test-token' })).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/v1/records?limit=1',
      expect.objectContaining({ headers: expect.any(Headers) })
    )
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(requestInit.headers).get('authorization')).toBe('Bearer test-token')
  })

  it.each([
    [401, 'authentication', '유효하지 않습니다'],
    [403, 'authorization', 'read 권한']
  ] as const)('maps HTTP %s into a helpful connection result', async (status, kind, error) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
    await expect(checkContextServerConnection({ endpointUrl: 'https://context.test', apiToken: 'test-token' })).resolves.toMatchObject({ ok: false, kind, error: expect.stringContaining(error) })
  })

  it('maps network failures without exposing the configured token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const result = await checkContextServerConnection({ endpointUrl: 'https://context.test', apiToken: 'test-token' })
    expect(result).toEqual(expect.objectContaining({ ok: false, kind: 'network' }))
    expect(result.ok ? '' : result.error).not.toContain('test-token')
  })
})
