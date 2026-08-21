export type BrainServerConfig = {
  endpointUrl: string
  apiToken: string
}

export type DailySummaryInput = {
  date: string
  timezone: string
}

export type SummaryLevel = 'quick' | 'standard' | 'deep'
export type EvidenceSupport = 'direct' | 'partial' | 'unverified' | 'conflict'
export type DailySummaryVariants = Record<SummaryLevel, string>
export type DailySummaryClaim = {
  id: string
  text: string
  sourceIds: string[]
  support: EvidenceSupport
}
export type DailySummarySource = {
  recordId: string
  preview: string
  recordedAt: string
  client: string
  title?: string
  url?: string
}

export type DailySummaryResult = {
  date: string
  timezone: string
  recordCount: number
  summary: string
  keyPoints: string[]
  variants?: DailySummaryVariants
  claims?: DailySummaryClaim[]
  sources?: DailySummarySource[]
}

export class BrainRequestError extends Error {}

export function normalizeBrainEndpointUrl(value: string) {
  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BrainRequestError('Brain Server 주소는 http 또는 https를 사용해야 합니다.')
  }
  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function headers(apiToken: string) {
  const value = new Headers({ 'content-type': 'application/json', accept: 'application/json' })
  if (apiToken) value.set('authorization', `Bearer ${apiToken}`)
  return value
}

function isDailySummaryResult(value: unknown): value is DailySummaryResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<DailySummaryResult>
  if (!(typeof result.date === 'string' &&
    typeof result.timezone === 'string' &&
    typeof result.recordCount === 'number' &&
    typeof result.summary === 'string' &&
    Array.isArray(result.keyPoints) &&
    result.keyPoints.every((point) => typeof point === 'string'))) return false

  if (result.variants !== undefined) {
    const variants = result.variants
    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return false
    if (!['quick', 'standard', 'deep'].every((level) => typeof variants[level as SummaryLevel] === 'string')) return false
  }

  if (result.claims !== undefined) {
    if (!Array.isArray(result.claims) || !result.claims.every((claim) => {
      if (!claim || typeof claim !== 'object') return false
      const item = claim as Partial<DailySummaryClaim>
      return typeof item.id === 'string' && typeof item.text === 'string' && Array.isArray(item.sourceIds) &&
        item.sourceIds.every((sourceId) => typeof sourceId === 'string') &&
        typeof item.support === 'string' && ['direct', 'partial', 'unverified', 'conflict'].includes(item.support)
    })) return false
  }

  if (result.sources !== undefined) {
    if (!Array.isArray(result.sources) || !result.sources.every((source) => {
      if (!source || typeof source !== 'object') return false
      const item = source as Partial<DailySummarySource>
      return typeof item.recordId === 'string' && typeof item.preview === 'string' &&
        typeof item.recordedAt === 'string' && typeof item.client === 'string' &&
        (item.title === undefined || typeof item.title === 'string') &&
        (item.url === undefined || typeof item.url === 'string')
    })) return false
  }

  return true
}

export function getDailySummaryVariant(result: DailySummaryResult, level: SummaryLevel): string {
  return result.variants?.[level] ?? result.summary
}

function errorMessage(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error
  return `Brain Server가 ${status} 응답을 반환했습니다.`
}

export async function runDailySummary(
  config: BrainServerConfig,
  input: DailySummaryInput,
  fetchImpl: typeof fetch = fetch
): Promise<DailySummaryResult> {
  let endpointUrl: string
  try {
    endpointUrl = normalizeBrainEndpointUrl(config.endpointUrl)
  } catch (error) {
    throw error instanceof BrainRequestError ? error : new BrainRequestError('Brain Server 주소를 확인해 주세요.')
  }
  const apiToken = config.apiToken.trim()

  let response: Response
  try {
    response = await fetchImpl(`${endpointUrl}/v1/actions`, {
      method: 'POST',
      headers: headers(apiToken),
      body: JSON.stringify({ action: 'daily-summary', input })
    })
  } catch (error) {
    throw new BrainRequestError(error instanceof Error ? `Brain Server에 연결할 수 없습니다: ${error.message}` : 'Brain Server에 연결할 수 없습니다.')
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new BrainRequestError('Brain Server가 올바르지 않은 응답을 반환했습니다.')
  }

  if (!response.ok) throw new BrainRequestError(errorMessage(response.status, body))
  if (!body || typeof body !== 'object' || !('result' in body) || !isDailySummaryResult(body.result)) {
    throw new BrainRequestError('Brain Server 응답에 Daily Summary 결과가 없습니다.')
  }
  return body.result
}

export function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function getLocalDate(date = new Date(), timeZone = getBrowserTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}
