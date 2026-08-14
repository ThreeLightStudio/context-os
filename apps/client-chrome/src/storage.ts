import { seedData } from './seed'
import { DEFAULT_BRAIN_SERVER_URL } from './config'
import type { AppData, DeploymentMode, SyncState } from './types'

const STORAGE_KEY = 'contextShelf:v1'
const API_TOKEN_STORAGE_KEY = 'contextShelf:api-token:v1'
const BRAIN_API_TOKEN_STORAGE_KEY = 'contextShelf:brain-api-token:v1'
// SHA-256 fingerprints let existing installs disconnect retired private Workers
// without retaining their hostnames or account identifiers in public source.
const RETIRED_CONTEXT_SERVER_HOST_FINGERPRINTS = new Set([
  'fd200e8cb7d2cf0b87c9f6e68775ac46c91c996eb1cbea085e29a520334da4da',
  '54a785326e20eb511727e9f93afbc0cc2fc97ace7503b142a4838fdea8f88a18'
])

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

export async function loadAppData(): Promise<AppData> {
  if (hasChromeStorage()) {
    const result = await new Promise<Record<string, StoredAppData | undefined>>((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (items) => {
        resolve(items as Record<string, StoredAppData | undefined>)
      })
    })
    return await migrateStoredData(result[STORAGE_KEY])
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return seedData

  try {
    return await migrateStoredData(JSON.parse(raw) as StoredAppData)
  } catch {
    return seedData
  }
}

export async function saveAppData(data: AppData): Promise<void> {
  if (hasChromeStorage()) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: data }, () => resolve())
    })
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export async function loadApiToken(): Promise<string> {
  if (hasChromeStorage()) {
    return await new Promise<string>((resolve) => {
      chrome.storage.local.get([API_TOKEN_STORAGE_KEY], (items) => {
        const token = items[API_TOKEN_STORAGE_KEY]
        resolve(typeof token === 'string' ? token.trim() : '')
      })
    })
  }

  try {
    return window.localStorage.getItem(API_TOKEN_STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export async function saveApiToken(token: string): Promise<void> {
  const value = token.trim()
  if (hasChromeStorage()) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ [API_TOKEN_STORAGE_KEY]: value }, () => resolve())
    })
    return
  }

  try {
    window.localStorage.setItem(API_TOKEN_STORAGE_KEY, value)
  } catch {
    // Private browsing or disabled storage should not prevent local capture.
  }
}

export async function loadBrainApiToken(): Promise<string> {
  if (hasChromeStorage()) {
    return await new Promise<string>((resolve) => {
      chrome.storage.local.get([BRAIN_API_TOKEN_STORAGE_KEY], (items) => {
        const token = items[BRAIN_API_TOKEN_STORAGE_KEY]
        resolve(typeof token === 'string' ? token.trim() : '')
      })
    })
  }

  try {
    return window.localStorage.getItem(BRAIN_API_TOKEN_STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export async function saveBrainApiToken(token: string): Promise<void> {
  const value = token.trim()
  if (hasChromeStorage()) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ [BRAIN_API_TOKEN_STORAGE_KEY]: value }, () => resolve())
    })
    return
  }

  try {
    window.localStorage.setItem(BRAIN_API_TOKEN_STORAGE_KEY, value)
  } catch {
  }
}

type LegacyAppData = Omit<AppData, 'schemaVersion' | 'sync'> & {
  schemaVersion: 1 | 2
  sync?: Partial<Omit<SyncState, 'mode' | 'setupComplete'>>
}

type StoredAppData = AppData | LegacyAppData

type NormalizedData = {
  data: AppData
  shouldPersist: boolean
  shouldClearApiToken: boolean
}

function normalizeEndpoint(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, '') ?? ''
}

async function isRetiredContextServer(endpointUrl: string): Promise<boolean> {
  try {
    const hostname = new URL(endpointUrl).hostname.toLocaleLowerCase()
    const digest = await globalThis.crypto?.subtle.digest('SHA-256', new TextEncoder().encode(hostname))
    if (!digest) return false
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return RETIRED_CONTEXT_SERVER_HOST_FINGERPRINTS.has(fingerprint)
  } catch {
    return false
  }
}

export function isLocalContextServerUrl(endpointUrl: string): boolean {
  try {
    const hostname = new URL(endpointUrl).hostname.toLocaleLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

function inferMode(endpointUrl: string): DeploymentMode {
  return endpointUrl === '' || isLocalContextServerUrl(endpointUrl) ? 'local' : 'cloudflare'
}

function normalizeStoredData(stored: StoredAppData | undefined, isRetiredEndpoint = false): NormalizedData {
  if (!stored) return { data: seedData, shouldPersist: false, shouldClearApiToken: false }

  const rawEndpoint = normalizeEndpoint(stored.sync?.endpointUrl)
  // Schema v1 did not carry an explicit connection choice. Retired endpoints
  // are reset as well, while all other user-configured endpoints are retained.
  const shouldClearApiToken = stored.schemaVersion === 1 || isRetiredEndpoint
  const endpointUrl = shouldClearApiToken ? '' : rawEndpoint
  const mode = stored.schemaVersion === 3 && stored.sync?.mode
    ? stored.sync.mode
    : inferMode(endpointUrl)
  const setupComplete = shouldClearApiToken
    ? false
    : stored.schemaVersion === 3 && typeof stored.sync?.setupComplete === 'boolean'
      ? stored.sync.setupComplete
      : endpointUrl !== ''
  const next: AppData = {
    ...stored,
    schemaVersion: 3,
    sync: {
      mode,
      setupComplete,
      endpointUrl,
      brainEndpointUrl: normalizeStoredBrainEndpoint(stored.sync?.brainEndpointUrl),
      outbox: stored.sync?.outbox ?? [],
      developerMode: stored.sync?.developerMode ?? false
    }
  }
  const shouldPersist = stored.schemaVersion !== 3 ||
    stored.sync?.mode !== mode ||
    stored.sync?.setupComplete !== setupComplete ||
    stored.sync?.endpointUrl !== endpointUrl ||
    stored.sync?.brainEndpointUrl !== next.sync.brainEndpointUrl ||
    stored.sync?.outbox === undefined ||
    stored.sync?.developerMode === undefined
  return { data: next, shouldPersist, shouldClearApiToken }
}

async function migrateStoredData(stored: StoredAppData | undefined): Promise<AppData> {
  const isRetiredEndpoint = await isRetiredContextServer(normalizeEndpoint(stored?.sync?.endpointUrl))
  const normalized = normalizeStoredData(stored, isRetiredEndpoint)
  await Promise.all([
    normalized.shouldPersist ? saveAppData(normalized.data) : Promise.resolve(),
    normalized.shouldClearApiToken ? saveApiToken('') : Promise.resolve()
  ])
  return normalized.data
}

export function normalizeData(data: StoredAppData | undefined): AppData {
  return normalizeStoredData(data).data
}

function normalizeStoredBrainEndpoint(endpointUrl: string | undefined) {
  const value = endpointUrl?.trim().replace(/\/+$/, '') ?? ''
  return value || DEFAULT_BRAIN_SERVER_URL
}

export function serializeBackup(data: AppData) {
  return JSON.stringify(data, null, 2)
}

export function parseBackup(raw: string): AppData {
  return normalizeData(JSON.parse(raw) as StoredAppData)
}
