export type SurfaceKind =
  | 'Store'
  | 'Money'
  | 'Code'
  | 'SNS'
  | 'Docs'
  | 'Support'
  | 'Analytics'
  | 'Admin'

export type LicensePlan = 'free' | 'pro' | 'beta'

export type SavedTab = {
  id: string
  title: string
  url: string
  domain: string
  surface: SurfaceKind
  favIconUrl?: string
}

export type Project = {
  id: string
  name: string
  color: string
  pinned?: boolean
  createdAt: string
}

export type ContextSession = {
  id: string
  projectId: string
  name: string
  note: string
  nextAction: string
  createdAt: string
  tabs: SavedTab[]
}

export type UrlMemory = {
  id: string
  projectId: string
  url: string
  domain: string
  note: string
  surface: SurfaceKind
  createdAt: string
}

export type ContextCapture = {
  id: string
  recordedAt: string
  data: {
    kind: 'capture'
    content: string
    source: { client: 'chrome' }
    context?: { browser?: { url?: string; title?: string } }
  }
}

export type CaptureOutboxItem = {
  memoryId: string
  capture: ContextCapture
  createdAt: string
  lastError?: string
}

export type DeploymentMode = 'local' | 'cloudflare'

export type SyncState = {
  mode: DeploymentMode
  setupComplete: boolean
  endpointUrl: string
  brainEndpointUrl: string
  outbox: CaptureOutboxItem[]
  developerMode: boolean
}

export type LicenseState = {
  plan: LicensePlan
  key?: string
  activatedAt?: string
}

export type AppData = {
  schemaVersion: 3
  activeProjectId: string
  projects: Project[]
  sessions: ContextSession[]
  memories: UrlMemory[]
  license: LicenseState
  sync: SyncState
}

export type ChromeSurface = 'sidepanel' | 'popup' | 'options'

export type AppView = 'side' | 'save' | 'resume' | 'memory' | 'library' | 'license'
