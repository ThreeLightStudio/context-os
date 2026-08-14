import type { ContextCapture, SavedTab, UrlMemory } from './types'

export const MAX_CAPTURE_BYTES = 32 * 1024
export const MAX_JSON_BYTES = 128 * 1024

const encoder = new TextEncoder()

export class CaptureValidationError extends Error {}

export type ContextServerConfig = {
  endpointUrl: string
  apiToken: string
}

export type ContextServerConnectionResult =
  | { ok: true }
  | { ok: false; kind: 'configuration' | 'authentication' | 'authorization' | 'network' | 'server'; error: string }

function byteLength(value: string) {
  return encoder.encode(value).byteLength
}

function optional(value: string | undefined) {
  return value?.trim() || undefined
}

export function createUrlMemoryCapture(memory: UrlMemory, tab: Pick<SavedTab, 'url' | 'title'>): ContextCapture {
  const content = memory.note.trim()
  if (!content) throw new CaptureValidationError('Memory note must not be empty.')
  if (byteLength(content) > MAX_CAPTURE_BYTES) {
    throw new CaptureValidationError('Memory note exceeds the 32KB capture limit.')
  }

  const url = optional(tab.url)
  const title = optional(tab.title)
  const browser = { ...(url ? { url } : {}), ...(title ? { title } : {}) }
  const capture: ContextCapture = {
    id: crypto.randomUUID(),
    recordedAt: memory.createdAt,
    data: {
      kind: 'capture',
      content,
      source: { client: 'chrome' },
      ...(Object.keys(browser).length > 0 ? { context: { browser } } : {})
    }
  }
  if (byteLength(JSON.stringify(capture)) > MAX_JSON_BYTES) {
    throw new CaptureValidationError('Capture request exceeds the 128KB request limit.')
  }
  return capture
}

export function normalizeEndpointUrl(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CaptureValidationError('Context Server URL must use http or https.')
  }
  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function getServerConfig(config: ContextServerConfig) {
  const endpointUrl = normalizeEndpointUrl(config.endpointUrl)
  const apiToken = config.apiToken.trim()
  if (!apiToken) throw new CaptureValidationError('Context Server API token is not configured.')
  return { endpointUrl, apiToken }
}

function createHeaders(apiToken: string, headers?: HeadersInit) {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('authorization', `Bearer ${apiToken}`)
  return requestHeaders
}

export async function checkContextServerConnection(config: ContextServerConfig): Promise<ContextServerConnectionResult> {
  try {
    const { endpointUrl, apiToken } = getServerConfig(config)
    const response = await fetch(`${endpointUrl}/v1/records?limit=1`, {
      headers: createHeaders(apiToken, { accept: 'application/json' })
    })
    if (response.ok) return { ok: true }
    if (response.status === 401) return { ok: false, kind: 'authentication', error: 'API token이 유효하지 않습니다.' }
    if (response.status === 403) return { ok: false, kind: 'authorization', error: 'API token에 read 권한이 없습니다.' }
    return { ok: false, kind: 'server', error: `서버가 ${response.status} 상태를 반환했습니다.` }
  } catch (error) {
    if (error instanceof CaptureValidationError) return { ok: false, kind: 'configuration', error: error.message }
    return { ok: false, kind: 'network', error: 'Context Server에 연결할 수 없습니다. URL과 서버 실행 상태를 확인해 주세요.' }
  }
}

export async function postCapture(config: ContextServerConfig, capture: ContextCapture): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { endpointUrl, apiToken } = getServerConfig(config)
    const response = await fetch(`${endpointUrl}/v1/records`, {
      method: 'POST',
      headers: createHeaders(apiToken, { 'content-type': 'application/json' }),
      body: JSON.stringify(capture)
    })
    if (response.status === 201 || response.status === 200) return { ok: true }
    let message = `Server returned ${response.status}.`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Keep the HTTP status when a proxy or Worker returns non-JSON.
    }
    return { ok: false, error: message }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Network request failed.' }
  }
}

export type RemoteCapture = {
  id: string
  recordedAt: string
  receivedAt: string
  data: {
    kind: 'capture'
    content: string
    source: { client: string }
    context?: { browser?: { url?: string; title?: string } }
  }
}

const MAX_RECORDS_PAGE_SIZE = 100

type RecordsResponse = {
  records?: unknown[]
  nextCursor?: unknown
  next_cursor?: unknown
}

function isRemoteCapture(record: unknown): record is RemoteCapture {
  if (!record || typeof record !== 'object') return false
  const value = record as Partial<RemoteCapture>
  return typeof value.id === 'string' && value.data?.kind === 'capture' && typeof value.data.content === 'string' && typeof value.recordedAt === 'string'
}

function getNextCursor(body: RecordsResponse) {
  const cursor = body.nextCursor ?? body.next_cursor
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : undefined
}

export async function listRemoteCaptures(config: ContextServerConfig, limit = 100): Promise<{ ok: true; captures: RemoteCapture[] } | { ok: false; error: string }> {
  try {
    const { endpointUrl, apiToken } = getServerConfig(config)
    const pageSize = Math.min(Math.max(Math.floor(limit), 1), MAX_RECORDS_PAGE_SIZE)
    const captures: RemoteCapture[] = []
    const seenRecordIds = new Set<string>()
    const seenCursors = new Set<string>()
    let offset = 0
    let cursor: string | undefined

    // The Context Server limits each response to 100 records. Keep requesting
    // subsequent pages so the library and "전체 생각 복사" both use every record.
    while (true) {
      const query = new URLSearchParams({ limit: String(pageSize) })
      if (cursor) query.set('cursor', cursor)
      else if (offset > 0) query.set('offset', String(offset))

      const response = await fetch(`${endpointUrl}/v1/records?${query}`, {
        headers: createHeaders(apiToken, { accept: 'application/json' })
      })
      if (!response.ok) return { ok: false, error: `Server returned ${response.status}.` }

      const body = await response.json() as RecordsResponse
      const records = Array.isArray(body.records) ? body.records : []
      let addedRecords = 0

      for (const record of records) {
        const id = record && typeof record === 'object' && 'id' in record && typeof record.id === 'string' ? record.id : undefined
        if (id && seenRecordIds.has(id)) continue
        if (id) seenRecordIds.add(id)
        addedRecords += 1
        if (isRemoteCapture(record)) captures.push(record)
      }

      const nextCursor = getNextCursor(body)
      const includesCursor = Object.hasOwn(body, 'nextCursor') || Object.hasOwn(body, 'next_cursor')
      if (nextCursor) {
        if (seenCursors.has(nextCursor)) {
          return { ok: false, error: '서버가 같은 다음 페이지를 반복해서 전체 기록을 불러올 수 없습니다.' }
        }
        seenCursors.add(nextCursor)
        cursor = nextCursor
        offset += records.length
        continue
      }

      // A cursor response explicitly tells us that there is no next page.
      if (includesCursor || records.length < pageSize) break

      // Offset pagination is the fallback for servers that do not return cursors.
      // Stop with an error instead of silently copying only the first 100 records
      // when a server ignores the offset parameter.
      if (addedRecords === 0) {
        return { ok: false, error: '서버가 다음 페이지를 제공하지 않아 전체 기록을 불러올 수 없습니다.' }
      }
      offset += records.length
    }

    return { ok: true, captures }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not load captures.' }
  }
}

export async function deleteRemoteCapture(config: ContextServerConfig, recordId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { endpointUrl, apiToken } = getServerConfig(config)
    const response = await fetch(`${endpointUrl}/v1/records/${encodeURIComponent(recordId)}`, {
      method: 'DELETE',
      headers: createHeaders(apiToken, { accept: 'application/json' })
    })
    if (response.ok) return { ok: true }
    let error = `Server returned ${response.status}.`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) error = body.error
    } catch {
      // Keep the HTTP status when there is no JSON error body.
    }
    return { ok: false, error }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not delete capture.' }
  }
}
