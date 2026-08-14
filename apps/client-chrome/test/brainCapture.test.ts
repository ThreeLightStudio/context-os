import { describe, expect, it, vi } from 'vitest'
import { getLocalDate, runDailySummary } from '../src/brainCapture'

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

    await expect(runDailySummary({ endpointUrl: 'http://127.0.0.1:8788/', apiToken: 'brain-token' }, {
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
