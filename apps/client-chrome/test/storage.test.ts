import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalContextServerUrl, loadAppData, loadStoredSettings, normalizeData, saveStoredSettings, StorageAccessError, subscribeToStoredSettingsChanges } from '../src/storage'
import type { AppData } from '../src/types'

function legacyData(endpointUrl: string): Omit<AppData, 'schemaVersion' | 'sync'> & {
  schemaVersion: 2
  sync: { endpointUrl: string; brainEndpointUrl: string; outbox: AppData['sync']['outbox']; developerMode: boolean }
} {
  return {
    schemaVersion: 2,
    activeProjectId: 'project-1',
    projects: [],
    sessions: [],
    memories: [],
    license: { plan: 'free' },
    sync: {
      endpointUrl,
      brainEndpointUrl: 'http://127.0.0.1:17002',
      outbox: [],
      developerMode: false
    }
  }
}

function versionOneData(): Omit<AppData, 'schemaVersion' | 'sync'> & { schemaVersion: 1 } {
  return {
    schemaVersion: 1,
    activeProjectId: 'project-1',
    projects: [],
    sessions: [],
    memories: [],
    license: { plan: 'free' }
  }
}

describe('storage schema migration', () => {
  it('starts new data in local mode without a Context Server URL', () => {
    const data = normalizeData(undefined)
    expect(data.schemaVersion).toBe(3)
    expect(data.sync).toMatchObject({ mode: 'local', setupComplete: false, endpointUrl: '' })
  })

  it('migrates v1 data to local setup without a server address', () => {
    const data = normalizeData(versionOneData())
    expect(data.sync).toMatchObject({ mode: 'local', setupComplete: false, endpointUrl: '' })
    expect(data.sync.brainEndpointUrl).toBe('http://127.0.0.1:17002')
  })

  it('keeps a stored workers.dev endpoint and API token across repeated loads', async () => {
    const endpointUrl = 'https://preserved.example.workers.dev'
    const values: Record<string, unknown> = {
      'contextShelf:v1': normalizeData(legacyData(endpointUrl)),
      'contextShelf:api-token:v1': 'ctx_preserved'
    }
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: (_keys: string[], callback: (items: Record<string, unknown>) => void) => callback(values),
          set: (next: Record<string, unknown>, callback: () => void) => {
            Object.assign(values, next)
            callback()
          }
        }
      }
    })

    const firstLoad = await loadAppData()
    const secondLoad = await loadAppData()

    expect(firstLoad.sync).toMatchObject({ mode: 'cloudflare', setupComplete: true, endpointUrl })
    expect(secondLoad.sync).toMatchObject({ mode: 'cloudflare', setupComplete: true, endpointUrl })
    expect(values['contextShelf:api-token:v1']).toBe('ctx_preserved')
  })

  it('keeps a user-configured Cloudflare endpoint and queued records', () => {
    const stored = legacyData('https://configured.example.workers.dev')
    stored.sync.outbox.push({
      memoryId: 'memory-1',
      capture: {
        id: '01983f0d-7b32-7b4d-8d5b-8ff24c3b1001',
        recordedAt: '2026-08-14T00:00:00.000Z',
        data: { kind: 'capture', content: 'keep me', source: { client: 'chrome' } }
      },
      createdAt: '2026-08-14T00:00:00.000Z'
    })

    const data = normalizeData(stored)
    expect(data.sync).toMatchObject({ mode: 'cloudflare', setupComplete: true, endpointUrl: 'https://configured.example.workers.dev' })
    expect(data.sync.outbox).toHaveLength(1)
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('local Context Server detection', () => {
  it.each(['http://localhost:17001', 'http://127.0.0.1:17001', 'http://[::1]:17001'])('recognizes %s', (url) => {
    expect(isLocalContextServerUrl(url)).toBe(true)
  })

  it('does not classify a Cloudflare URL as local', () => {
    expect(isLocalContextServerUrl('https://context.example.com')).toBe(false)
  })
})

describe('Chrome storage safety', () => {
  it('returns a storage error instead of treating a failed read as a new installation', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        get lastError() {
          return { message: 'storage unavailable' }
        }
      },
      storage: {
        local: {
          get: (_keys: string[], callback: (items: Record<string, unknown>) => void) => callback({})
        }
      }
    })

    await expect(loadStoredSettings()).rejects.toBeInstanceOf(StorageAccessError)
  })

  it('writes app data and both tokens together', async () => {
    const values: Record<string, unknown> = {}
    const writes: Record<string, unknown>[] = []
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          set: (next: Record<string, unknown>, callback: () => void) => {
            writes.push(next)
            Object.assign(values, next)
            callback()
          }
        }
      }
    })

    const data = normalizeData(legacyData('https://saved.example.workers.dev'))
    await saveStoredSettings({ data, apiToken: 'ctx_saved', brainApiToken: 'brain_saved' })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      'contextShelf:v1': data,
      'contextShelf:api-token:v1': 'ctx_saved',
      'contextShelf:brain-api-token:v1': 'brain_saved'
    })
    expect(values).toMatchObject(writes[0])
  })

  it('reports a failed bundled write without changing the stored values', async () => {
    const values: Record<string, unknown> = { 'contextShelf:api-token:v1': 'ctx_existing' }
    vi.stubGlobal('chrome', {
      runtime: {
        get lastError() {
          return { message: 'quota exceeded' }
        }
      },
      storage: {
        local: {
          set: (_next: Record<string, unknown>, callback: () => void) => callback()
        }
      }
    })

    await expect(saveStoredSettings({
      data: normalizeData(legacyData('https://saved.example.workers.dev')),
      apiToken: 'ctx_new',
      brainApiToken: 'brain_new'
    })).rejects.toBeInstanceOf(StorageAccessError)
    expect(values['contextShelf:api-token:v1']).toBe('ctx_existing')
  })

  it('notifies surfaces only for relevant local storage changes', () => {
    let changeHandler: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined
    const listener = vi.fn()
    vi.stubGlobal('chrome', {
      storage: {
        local: {},
        onChanged: {
          addListener: (handler: typeof changeHandler) => { changeHandler = handler },
          removeListener: vi.fn()
        }
      }
    })

    const unsubscribe = subscribeToStoredSettingsChanges(listener)
    changeHandler?.({ unrelated: { newValue: true } }, 'local')
    changeHandler?.({ 'contextShelf:v1': { newValue: normalizeData(undefined) } }, 'local')
    changeHandler?.({ 'contextShelf:v1': { newValue: normalizeData(undefined) } }, 'sync')

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
