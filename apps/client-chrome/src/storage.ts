import { seedData } from './seed'
import { DEFAULT_BRAIN_SERVER_URL } from './config'
import type { AppData, DeploymentMode, SyncState } from './types'

const STORAGE_KEY = 'contextShelf:v1'
const API_TOKEN_STORAGE_KEY = 'contextShelf:api-token:v1'
const BRAIN_API_TOKEN_STORAGE_KEY = 'contextShelf:brain-api-token:v1'

export class StorageAccessError extends Error {
  constructor(operation: 'read' | 'write') {
    super(`Extension storage ${operation} failed.`)
    this.name = 'StorageAccessError'
  }
}

export type StoredSettings = {
  data: AppData
  apiToken: string
  brainApiToken: string
}

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function storageError(operation: 'read' | 'write') {
  return chrome.runtime?.lastError ? new StorageAccessError(operation) : undefined
}

async function readChromeStorage(keys: string[]): Promise<Record<string, unknown>> {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const error = storageError('read')
      if (error) {
        reject(error)
        return
      }
      resolve(items)
    })
  })
}

async function writeChromeStorage(values: Record<string, unknown>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = storageError('write')
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function readLocalStorage(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    throw new StorageAccessError('read')
  }
}

function writeLocalStorage(values: Record<string, string>) {
  try {
    for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value)
  } catch {
    throw new StorageAccessError('write')
  }
}

async function readStoredValues(): Promise<Record<string, unknown>> {
  const keys = [STORAGE_KEY, API_TOKEN_STORAGE_KEY, BRAIN_API_TOKEN_STORAGE_KEY]
  if (hasChromeStorage()) return await readChromeStorage(keys)

  return Object.fromEntries(keys.map((key) => [key, readLocalStorage(key)]))
}

function parseStoredAppData(value: unknown): StoredAppData | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as StoredAppData
    } catch {
      throw new StorageAccessError('read')
    }
  }
  if (typeof value !== 'object') throw new StorageAccessError('read')
  return value as StoredAppData
}

export async function loadStoredSettings(): Promise<StoredSettings> {
  const values = await readStoredValues()
  return {
    data: await migrateStoredData(parseStoredAppData(values[STORAGE_KEY])),
    apiToken: typeof values[API_TOKEN_STORAGE_KEY] === 'string' ? values[API_TOKEN_STORAGE_KEY].trim() : '',
    brainApiToken: typeof values[BRAIN_API_TOKEN_STORAGE_KEY] === 'string' ? values[BRAIN_API_TOKEN_STORAGE_KEY].trim() : ''
  }
}

export async function loadAppData(): Promise<AppData> {
  return (await loadStoredSettings()).data
}

export async function saveAppData(data: AppData): Promise<void> {
  if (hasChromeStorage()) {
    await writeChromeStorage({ [STORAGE_KEY]: data })
    return
  }

  writeLocalStorage({ [STORAGE_KEY]: JSON.stringify(data) })
}

export async function loadApiToken(): Promise<string> {
  return (await loadStoredSettings()).apiToken
}

export async function saveApiToken(token: string): Promise<void> {
  const value = token.trim()
  if (hasChromeStorage()) {
    await writeChromeStorage({ [API_TOKEN_STORAGE_KEY]: value })
    return
  }

  writeLocalStorage({ [API_TOKEN_STORAGE_KEY]: value })
}

export async function loadBrainApiToken(): Promise<string> {
  return (await loadStoredSettings()).brainApiToken
}

export async function saveBrainApiToken(token: string): Promise<void> {
  const value = token.trim()
  if (hasChromeStorage()) {
    await writeChromeStorage({ [BRAIN_API_TOKEN_STORAGE_KEY]: value })
    return
  }

  writeLocalStorage({ [BRAIN_API_TOKEN_STORAGE_KEY]: value })
}

export async function saveStoredSettings(settings: StoredSettings): Promise<void> {
  const values = {
    [STORAGE_KEY]: settings.data,
    [API_TOKEN_STORAGE_KEY]: settings.apiToken.trim(),
    [BRAIN_API_TOKEN_STORAGE_KEY]: settings.brainApiToken.trim()
  }
  if (hasChromeStorage()) {
    await writeChromeStorage(values)
    return
  }

  writeLocalStorage({
    [STORAGE_KEY]: JSON.stringify(settings.data),
    [API_TOKEN_STORAGE_KEY]: values[API_TOKEN_STORAGE_KEY],
    [BRAIN_API_TOKEN_STORAGE_KEY]: values[BRAIN_API_TOKEN_STORAGE_KEY]
  })
}

export function subscribeToStoredSettingsChanges(listener: () => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {}

  const handleChanges = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return
    if ([STORAGE_KEY, API_TOKEN_STORAGE_KEY, BRAIN_API_TOKEN_STORAGE_KEY].some((key) => key in changes)) listener()
  }
  chrome.storage.onChanged.addListener(handleChanges)
  return () => chrome.storage.onChanged.removeListener(handleChanges)
}

type LegacyAppData = Omit<AppData, 'schemaVersion' | 'sync'> & {
  schemaVersion: 1 | 2
  sync?: Partial<Omit<SyncState, 'mode' | 'setupComplete'>>
}

type StoredAppData = AppData | LegacyAppData

type NormalizedData = {
  data: AppData
  shouldPersist: boolean
}

function normalizeEndpoint(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, '') ?? ''
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

function normalizeStoredData(stored: StoredAppData | undefined): NormalizedData {
  if (!stored) return { data: seedData, shouldPersist: false }

  const rawEndpoint = normalizeEndpoint(stored.sync?.endpointUrl)
  // Schema v1 did not carry an explicit connection choice, so start it locally.
  // Later schemas retain the user's saved endpoint without inspecting its host.
  const endpointUrl = stored.schemaVersion === 1 ? '' : rawEndpoint
  const mode = stored.schemaVersion === 3 && stored.sync?.mode
    ? stored.sync.mode
    : inferMode(endpointUrl)
  const setupComplete = stored.schemaVersion === 3 && typeof stored.sync?.setupComplete === 'boolean'
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
  return { data: next, shouldPersist }
}

async function migrateStoredData(stored: StoredAppData | undefined): Promise<AppData> {
  const normalized = normalizeStoredData(stored)
  if (normalized.shouldPersist) await saveAppData(normalized.data)
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
