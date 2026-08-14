import type { RemoteCapture } from './contextCapture'

export type ThoughtCopyRange = 'today' | 'week' | 'month' | 'custom' | 'all'

export type ThoughtDateRange = {
  start?: Date
  end?: Date
  label: string
}

function isValidDate(value: Date) {
  return !Number.isNaN(value.getTime())
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function endOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999)
}

function parseCalendarDate(value: string, edge: 'start' | 'end') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return undefined
  return edge === 'start' ? startOfDay(date) : endOfDay(date)
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' }).format(value)
}

export function getThoughtCopyRange(
  range: ThoughtCopyRange,
  now = new Date(),
  customStart = '',
  customEnd = ''
): ThoughtDateRange | { error: string } {
  if (range === 'all') return { label: '전체 기록' }

  if (range === 'custom') {
    const start = parseCalendarDate(customStart, 'start')
    const end = parseCalendarDate(customEnd, 'end')
    if (!start || !end) return { error: '시작일과 종료일을 모두 선택해 주세요.' }
    if (start > end) return { error: '종료일은 시작일보다 빠를 수 없습니다.' }
    return { start, end, label: `${formatDate(start)}–${formatDate(end)} 기록` }
  }

  const today = startOfDay(now)
  if (range === 'today') return { start: today, end: endOfDay(now), label: `${formatDate(now)} 기록` }

  if (range === 'week') {
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    return { start: weekStart, end: endOfDay(weekEnd), label: `${formatDate(weekStart)}–${formatDate(weekEnd)} 기록` }
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { start: monthStart, end: endOfDay(monthEnd), label: `${now.getFullYear()}년 ${now.getMonth() + 1}월 기록` }
}

export function filterThoughtsForCopy(captures: RemoteCapture[], range: ThoughtDateRange) {
  return captures
    .filter((capture) => {
      const recordedAt = new Date(capture.recordedAt)
      if (!isValidDate(recordedAt)) return false
      return (!range.start || recordedAt >= range.start) && (!range.end || recordedAt <= range.end)
    })
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
}

export function formatThoughtsForClipboard(captures: RemoteCapture[], label: string) {
  const heading = `Context Shelf 생각 기록\n범위: ${label}\n생각 ${captures.length}개`
  if (captures.length === 0) return `${heading}\n\n이 기간에 기록한 생각이 없습니다.`

  const timestamp = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
  const entries = captures.map((capture) => {
    const browser = capture.data.context?.browser
    const source = [browser?.title ? `출처: ${browser.title}` : '', browser?.url ? `URL: ${browser.url}` : ''].filter(Boolean)
    return ['---', timestamp.format(new Date(capture.recordedAt)), capture.data.content, ...source].join('\n')
  })
  return [heading, ...entries].join('\n\n')
}

export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('브라우저에서 클립보드에 접근할 수 없습니다.')
}
