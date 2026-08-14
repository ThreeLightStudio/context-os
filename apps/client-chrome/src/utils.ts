import type { SurfaceKind } from './types'

export function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function formatTimeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.round(diff / 60000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

export function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'local'
  }
}

export function inferSurface(url: string): SurfaceKind {
  const domain = getDomain(url)
  if (/appstoreconnect|play\.google/.test(domain)) return 'Store'
  if (/stripe|paddle|lemonsqueezy/.test(domain)) return 'Money'
  if (/github|linear|vercel/.test(domain)) return 'Code'
  if (/threads|x\.com|twitter|linkedin|instagram/.test(domain)) return 'SNS'
  if (/docs\.google|notion|confluence/.test(domain)) return 'Docs'
  if (/intercom|zendesk|helpscout/.test(domain)) return 'Support'
  if (/analytics|posthog|mixpanel|plausible/.test(domain)) return 'Analytics'
  return 'Admin'
}

export function formatSessionName(projectName: string) {
  return `${projectName} context - ${new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric'
  }).format(new Date())}`
}

export function sortNewest<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}
