import { describe, expect, it } from 'vitest'
import { createI18n, normalizeLocale, normalizeLocalePreference, resolveLocale } from '../src/i18n'

describe('i18n', () => {
  it('normalizes supported browser language tags', () => {
    expect(normalizeLocale('ko-KR')).toBe('ko')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('fr-FR')).toBe('en')
    expect(normalizeLocale(undefined)).toBe('en')
  })

  it('resolves an explicit preference before the browser language', () => {
    expect(normalizeLocalePreference('ko')).toBe('ko')
    expect(normalizeLocalePreference('invalid')).toBe('auto')
    expect(resolveLocale('auto', 'ko-KR')).toBe('ko')
    expect(resolveLocale('auto', 'en-US')).toBe('en')
    expect(resolveLocale('ko', 'en-US')).toBe('ko')
    expect(resolveLocale('en', 'ko-KR')).toBe('en')
  })

  it('interpolates dynamic values in each locale', () => {
    expect(createI18n('ko').t('summary.recordCount', { count: 3 })).toBe('Context 기록 3개')
    expect(createI18n('en').t('summary.recordCount', { count: 3 })).toBe('3 Context record(s)')
    expect(createI18n('en').t('capture.queued', { error: 'offline' })).toContain('offline')
  })

  it('formats dates using the selected locale', () => {
    const date = new Date('2026-08-13T00:00:00.000Z')
    expect(createI18n('ko').formatDate(date, { timeZone: 'UTC', dateStyle: 'medium' })).toContain('2026')
    expect(createI18n('en').formatDate(date, { timeZone: 'UTC', dateStyle: 'medium' })).toContain('2026')
  })
})
