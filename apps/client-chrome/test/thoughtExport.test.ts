import { describe, expect, it } from 'vitest'
import { filterThoughtsForCopy, formatThoughtsForClipboard, getThoughtCopyRange } from '../src/thoughtExport'
import type { RemoteCapture } from '../src/contextCapture'

const captures: RemoteCapture[] = [
  { id: 'old', recordedAt: '2026-07-19T13:00:00.000Z', receivedAt: '', data: { kind: 'capture', content: '지난주 생각', source: { client: 'chrome' } } },
  { id: 'today', recordedAt: '2026-07-25T02:00:00.000Z', receivedAt: '', data: { kind: 'capture', content: '오늘 생각', source: { client: 'chrome' }, context: { browser: { title: 'Example', url: 'https://example.com' } } } },
  { id: 'future', recordedAt: '2026-08-01T02:00:00.000Z', receivedAt: '', data: { kind: 'capture', content: '다음 달 생각', source: { client: 'chrome' } } }
]

describe('thought copy ranges', () => {
  const now = new Date(2026, 6, 25, 12)

  it('uses Monday through Sunday for the current week', () => {
    const range = getThoughtCopyRange('week', now)
    if ('error' in range) throw new Error(range.error)
    expect(range.start).toEqual(new Date(2026, 6, 20))
    expect(range.end).toEqual(new Date(2026, 6, 26, 23, 59, 59, 999))
  })

  it('includes every selected calendar day for a custom range', () => {
    const range = getThoughtCopyRange('custom', now, '2026-07-25', '2026-07-25')
    if ('error' in range) throw new Error(range.error)
    expect(filterThoughtsForCopy(captures, range).map((capture) => capture.id)).toEqual(['today'])
  })

  it('rejects a backwards custom range', () => {
    expect(getThoughtCopyRange('custom', now, '2026-07-26', '2026-07-25')).toEqual({ error: '종료일은 시작일보다 빠를 수 없습니다.' })
  })
})

describe('thought clipboard format', () => {
  it('keeps the thought, timestamp, and linked source together', () => {
    const copied = formatThoughtsForClipboard([captures[1]], '오늘 기록')
    expect(copied).toContain('Context Shelf 생각 기록')
    expect(copied).toContain('오늘 생각')
    expect(copied).toContain('출처: Example')
    expect(copied).toContain('URL: https://example.com')
  })
})
