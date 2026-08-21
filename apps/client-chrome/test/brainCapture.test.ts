import { describe, expect, it, vi } from 'vitest'
import { getDailySummaryVariant, getLocalDate, runDailySummary } from '../src/brainCapture'

describe('runDailySummary', () => {
  it('sends the daily-summary action and returns the structured result', async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer brain-token')
      expect(JSON.parse(String(init?.body))).toEqual({
        action: 'daily-summary',
        input: { date: '2026-08-13', timezone: 'Asia/Seoul' }
      })
      return new Response(JSON.stringify({ result: {
        date: '2026-08-13',
        timezone: 'Asia/Seoul',
        recordCount: 1,
        summary: '오늘 요약',
        keyPoints: ['핵심 기록']
      } }))
    })

    await expect(runDailySummary({ endpointUrl: 'http://127.0.0.1:17002/', apiToken: 'brain-token' }, {
      date: '2026-08-13',
      timezone: 'Asia/Seoul'
    }, fetchImpl)).resolves.toEqual({
      date: '2026-08-13',
      timezone: 'Asia/Seoul',
      recordCount: 1,
      summary: '오늘 요약',
      keyPoints: ['핵심 기록']
    })
  })

  it('does not require a token when Brain Server auth is disabled', async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBeNull()
      return new Response(JSON.stringify({ result: {
        date: '2026-08-13', timezone: 'Asia/Seoul', recordCount: 0,
        summary: 'No context records found for the selected date.', keyPoints: []
      } }))
    })

    await expect(runDailySummary({ endpointUrl: 'http://brain.test', apiToken: '' }, {
      date: '2026-08-13', timezone: 'Asia/Seoul'
    }, fetchImpl)).resolves.toMatchObject({ recordCount: 0 })
  })

  it('accepts evidence-linked variants and falls back for legacy responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: {
      date: '2026-08-13',
      timezone: 'Asia/Seoul',
      recordCount: 1,
      summary: '기본 요약',
      keyPoints: ['핵심'],
      variants: { quick: '짧게', standard: '일반적으로', deep: '자세히' },
      claims: [{ id: 'claim-1', text: '주장', sourceIds: ['record-1'], support: 'direct' }],
      sources: [{ recordId: 'record-1', preview: '원문 기록', recordedAt: '2026-08-13T00:00:00.000Z', client: 'chrome' }]
    } })))

    const result = await runDailySummary({ endpointUrl: 'http://brain.test', apiToken: '' }, {
      date: '2026-08-13', timezone: 'Asia/Seoul'
    }, fetchImpl)

    expect(result.sources?.[0].recordId).toBe('record-1')
    expect(getDailySummaryVariant(result, 'quick')).toBe('짧게')
    expect(getDailySummaryVariant({ ...result, variants: undefined }, 'deep')).toBe('기본 요약')
  })

  it('maps server errors into a user-facing request error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'context unavailable' }), { status: 502 }))
    await expect(runDailySummary({ endpointUrl: 'http://brain.test', apiToken: '' }, {
      date: '2026-08-13', timezone: 'Asia/Seoul'
    }, fetchImpl)).rejects.toThrow('context unavailable')
  })
})

describe('getLocalDate', () => {
  it('formats the same instant using the requested timezone', () => {
    const instant = new Date('2026-08-13T00:30:00.000Z')
    expect(getLocalDate(instant, 'Asia/Seoul')).toBe('2026-08-13')
    expect(getLocalDate(instant, 'America/Los_Angeles')).toBe('2026-08-12')
  })
})
