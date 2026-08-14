import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalContextServerUrl, loadAppData, normalizeData } from '../src/storage'
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
      brainEndpointUrl: 'http://127.0.0.1:8788',
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
    expect(data.sync.brainEndpointUrl).toBe('http://127.0.0.1:8788')
  })

  it('clears a retired connection and its API token while preserving local data', async () => {
    const stored = legacyData('https://retired.example.invalid')
    stored.sync.outbox.push({
      memoryId: 'memory-1',
      capture: {
        id: '01983f0d-7b32-7b4d-8d5b-8ff24c3b1001',
        recordedAt: '2026-08-14T00:00:00.000Z',
        data: { kind: 'capture', content: 'keep me', source: { client: 'chrome' } }
      },
      createdAt: '2026-08-14T00:00:00.000Z'
    })
    const values: Record<string, unknown> = {
      'contextShelf:v1': stored,
      'contextShelf:api-token:v1': 'ctx_retired'
    }
    vi.stubGlobal('crypto', {
      subtle: {
        digest: async () => new Uint8Array([
          253, 32, 14, 140, 183, 210, 207, 11, 135, 201, 246, 230, 135, 117, 172, 70,
          201, 28, 153, 110, 177, 203, 234, 8, 94, 41, 165, 32, 51, 77, 164, 218
        ]).buffer
      }
    })
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

    const data = await loadAppData()

    expect(data.sync).toMatchObject({ mode: 'local', setupComplete: false, endpointUrl: '' })
    expect(data.sync.outbox).toHaveLength(1)
    expect(values['contextShelf:api-token:v1']).toBe('')
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
  it.each(['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787'])('recognizes %s', (url) => {
    expect(isLocalContextServerUrl(url)).toBe(true)
  })

  it('does not classify a Cloudflare URL as local', () => {
    expect(isLocalContextServerUrl('https://context.example.com')).toBe(false)
  })
})
