import type { RemoteCapture } from './contextCapture'
import { createI18n } from './i18n'
import type { Locale } from './i18n'

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

export function getThoughtCopyRange(
  range: ThoughtCopyRange,
  now = new Date(),
  customStart = '',
  customEnd = '',
  locale: Locale = 'ko'
): ThoughtDateRange | { error: string } {
  const { t, formatDate } = createI18n(locale)
  if (range === 'all') return { label: t('thoughts.copyRangeAll') }

  if (range === 'custom') {
    const start = parseCalendarDate(customStart, 'start')
    const end = parseCalendarDate(customEnd, 'end')
    if (!start || !end) return { error: t('thoughts.copyDatesRequired') }
    if (start > end) return { error: t('thoughts.copyDateOrder') }
    return { start, end, label: t('thoughts.copyRangeCustom', { start: formatDate(start, { dateStyle: 'long' }), end: formatDate(end, { dateStyle: 'long' }) }) }
  }

  const today = startOfDay(now)
  if (range === 'today') return { start: today, end: endOfDay(now), label: t('thoughts.copyRangeToday', { date: formatDate(now, { dateStyle: 'long' }) }) }

  if (range === 'week') {
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    return { start: weekStart, end: endOfDay(weekEnd), label: t('thoughts.copyRangeWeek', { start: formatDate(weekStart, { dateStyle: 'long' }), end: formatDate(weekEnd, { dateStyle: 'long' }) }) }
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { start: monthStart, end: endOfDay(monthEnd), label: t('thoughts.copyRangeMonth', { year: now.getFullYear(), month: now.getMonth() + 1 }) }
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

export function formatThoughtsForClipboard(captures: RemoteCapture[], label: string, locale: Locale = 'ko') {
  const { t, formatDate } = createI18n(locale)
  const heading = [t('thoughts.clipboardTitle'), t('thoughts.clipboardRange', { label }), t('thoughts.clipboardCount', { count: captures.length })].join('\n')
  if (captures.length === 0) return `${heading}\n\n${t('thoughts.clipboardEmpty')}`

  const entries = captures.map((capture) => {
    const browser = capture.data.context?.browser
    const source = [browser?.title ? t('thoughts.clipboardSource', { title: browser.title }) : '', browser?.url ? t('thoughts.clipboardUrl', { url: browser.url }) : ''].filter(Boolean)
    return ['---', formatDate(new Date(capture.recordedAt), { dateStyle: 'medium', timeStyle: 'short' }), capture.data.content, ...source].join('\n')
  })
  return [heading, ...entries].join('\n\n')
}

export async function copyTextToClipboard(text: string, locale: Locale = 'ko') {
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
  if (!copied) throw new Error(createI18n(locale).t('thoughts.clipboardError'))
}
