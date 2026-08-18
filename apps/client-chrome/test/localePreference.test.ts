import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadLocalePreference, saveLocalePreference, subscribeToLocalePreferenceChanges } from '../src/storage'

afterEach(() => vi.unstubAllGlobals())

function installChromeStorage(initial: Record<string, unknown> = {}) {
  const values = { ...initial }
  let changeHandler: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined
  const removeListener = vi.fn()
  vi.stubGlobal('chrome', {
    runtime: {},
    storage: {
      local: {
        get: (keys: string[], callback: (items: Record<string, unknown>) => void) => callback(Object.fromEntries(keys.map((key) => [key, values[key]]))),
        set: (next: Record<string, unknown>, callback: () => void) => {
          Object.assign(values, next)
          callback()
        }
      },
      onChanged: {
        addListener: (handler: typeof changeHandler) => { changeHandler = handler },
        removeListener
      }
    }
  })
  return { values, emit: (changes: Record<string, chrome.storage.StorageChange>, areaName = 'local') => changeHandler?.(changes, areaName), removeListener }
}

describe('locale preference storage', () => {
  it('defaults to auto and persists explicit preferences separately', async () => {
    const { values } = installChromeStorage()
    await expect(loadLocalePreference()).resolves.toBe('auto')
    await saveLocalePreference('ko')
    expect(values['contextShelf:locale-preference:v1']).toBe('ko')
    await expect(loadLocalePreference()).resolves.toBe('ko')
  })

  it('falls back to auto for invalid stored values', async () => {
    installChromeStorage({ 'contextShelf:locale-preference:v1': 'fr' })
    await expect(loadLocalePreference()).resolves.toBe('auto')
  })

  it('notifies listeners only for local preference changes', () => {
    const { emit, removeListener } = installChromeStorage()
    const listener = vi.fn()
    const unsubscribe = subscribeToLocalePreferenceChanges(listener)
    emit({ unrelated: { newValue: true } })
    emit({ 'contextShelf:locale-preference:v1': { newValue: 'en' } })
    emit({ 'contextShelf:locale-preference:v1': { newValue: 'ko' } }, 'sync')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(removeListener).toHaveBeenCalledOnce()
  })
})
