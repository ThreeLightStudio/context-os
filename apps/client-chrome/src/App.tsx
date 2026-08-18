import { ArrowLeft, CalendarDays, Check, Cloud, Copy, Link2, Monitor, RefreshCw, Search, Send, Settings, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getActiveTab, subscribeToActiveTab } from './chromeApi'
import { getBrowserTimeZone, getLocalDate, normalizeBrainEndpointUrl, runDailySummary } from './brainCapture'
import type { DailySummaryResult } from './brainCapture'
import { DEFAULT_BRAIN_SERVER_URL } from './config'
import { checkContextServerConnection, createUrlMemoryCapture, deleteRemoteCapture, listRemoteCaptures, normalizeEndpointUrl, postCapture } from './contextCapture'
import type { RemoteCapture } from './contextCapture'
import { filterLinkedThoughtsForUrl, LinkedThoughtsLoader } from './linkedThoughts'
import { createI18n, resolveLocale } from './i18n'
import type { LocalePreference } from './i18n'
import { loadLocalePreference, loadStoredSettings, saveAppData, saveLocalePreference, saveStoredSettings, subscribeToLocalePreferenceChanges, subscribeToStoredSettingsChanges } from './storage'
import { copyTextToClipboard, filterThoughtsForCopy, formatThoughtsForClipboard, getThoughtCopyRange } from './thoughtExport'
import type { AppData, CaptureOutboxItem, ChromeSurface, DeploymentMode, SavedTab, UrlMemory } from './types'
import type { ThoughtCopyRange } from './thoughtExport'
import { createId, nowIso } from './utils'

type Screen = 'capture' | 'settings' | 'setup' | 'thoughts' | 'summary'
type ThoughtLinkResult = 'opened' | 'missing' | 'invalid' | 'failed'
type StorageLoadState = 'loading' | 'ready' | 'error'

export function canCaptureOnUrl(url: string | undefined) {
  if (!url) return false
  try {
    const destination = new URL(url)
    return destination.protocol !== 'chrome:' || (destination.hostname === 'newtab' && destination.pathname === '/')
  } catch {
    return false
  }
}

export function App({ surface }: { surface: ChromeSurface }) {
  const [localePreference, setLocalePreference] = useState<LocalePreference>('auto')
  const locale = resolveLocale(localePreference)
  const { t, formatDate } = useMemo(() => createI18n(locale), [locale])
  const [data, setData] = useState<AppData | null>(null)
  const [storageLoadState, setStorageLoadState] = useState<StorageLoadState>('loading')
  const [storageError, setStorageError] = useState('')
  const [activeTab, setActiveTab] = useState<SavedTab | null>(null)
  const [note, setNote] = useState('')
  const [screen, setScreen] = useState<Screen>('capture')
  const [deploymentMode, setDeploymentMode] = useState<DeploymentMode>('local')
  const [endpoint, setEndpoint] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [brainEndpoint, setBrainEndpoint] = useState('')
  const [brainApiToken, setBrainApiToken] = useState('')
  const [brainTokenInput, setBrainTokenInput] = useState('')
  const [status, setStatus] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('')
  const [connectionChecking, setConnectionChecking] = useState(false)
  const [thoughts, setThoughts] = useState<RemoteCapture[]>([])
  const [thoughtQuery, setThoughtQuery] = useState('')
  const [thoughtUrlFilter, setThoughtUrlFilter] = useState('')
  const [thoughtStatus, setThoughtStatus] = useState('')
  const [copyStart, setCopyStart] = useState('')
  const [copyEnd, setCopyEnd] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [linkedThoughts, setLinkedThoughts] = useState<RemoteCapture[]>([])
  const [summaryDate, setSummaryDate] = useState(() => getLocalDate())
  const [summaryResult, setSummaryResult] = useState<DailySummaryResult | null>(null)
  const [summaryStatus, setSummaryStatus] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [settingsChangedElsewhere, setSettingsChangedElsewhere] = useState(false)
  const activeTabUrlRef = useRef<string | undefined>(undefined)
  const noteRef = useRef('')
  const screenRef = useRef<Screen>('capture')
  const tRef = useRef(t)
  const settingsDirtyRef = useRef(false)
  const brainSettingsDirtyRef = useRef(false)
  const linkedThoughtsLoaderRef = useRef<LinkedThoughtsLoader | null>(null)
  if (!linkedThoughtsLoaderRef.current) linkedThoughtsLoaderRef.current = new LinkedThoughtsLoader()
  const linkedThoughtsLoader = linkedThoughtsLoaderRef.current

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    let active = true
    void loadLocalePreference().then((preference) => {
      if (active) setLocalePreference(preference)
    }).catch(() => {})
    const unsubscribe = subscribeToLocalePreferenceChanges(() => {
      void loadLocalePreference().then((preference) => {
        if (active) setLocalePreference(preference)
      }).catch(() => {})
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    noteRef.current = note
  }, [note])

  useEffect(() => {
    screenRef.current = screen
  }, [screen])

  const refreshStoredSettings = useCallback(async (options: { initial?: boolean; replaceSettingsForm?: boolean } = {}) => {
    if (options.initial) {
      setStorageLoadState('loading')
      setStorageError('')
    }
    try {
      const stored = await loadStoredSettings()
      setData(stored.data)
      const preserveSettingsForm = screenRef.current === 'settings' && settingsDirtyRef.current && !options.replaceSettingsForm
      if (preserveSettingsForm) {
        setSettingsChangedElsewhere(true)
      } else {
        setDeploymentMode(stored.data.sync.mode)
        setEndpoint(stored.data.sync.endpointUrl)
        setApiToken(stored.apiToken)
        setBrainEndpoint(stored.data.sync.brainEndpointUrl)
        setBrainApiToken(stored.brainApiToken)
        setSettingsChangedElsewhere(false)
        if (options.initial) setScreen(stored.data.sync.setupComplete ? 'capture' : 'setup')
      }
      setStorageLoadState('ready')
    } catch {
      setStorageLoadState('error')
      setStorageError(tRef.current('app.storageErrorDescription'))
    }
  }, [])

  useEffect(() => {
    void refreshStoredSettings({ initial: true, replaceSettingsForm: true })
    const unsubscribe = subscribeToStoredSettingsChanges(() => { void refreshStoredSettings() })
    void getActiveTab().then(setActiveTab)
    const unsubscribeActiveTab = subscribeToActiveTab(setActiveTab)
    return () => {
      unsubscribe()
      unsubscribeActiveTab()
    }
  }, [refreshStoredSettings])

  const persist = useCallback(async (next: AppData) => {
    await saveAppData(next)
    setData(next)
  }, [])

  const linkedEndpointUrl = data?.sync.endpointUrl ?? ''

  const loadLinkedThoughts = useCallback(async (url: string, signal: AbortSignal) => {
    if (!linkedEndpointUrl || !apiToken) {
      return { ok: false as const }
    }
    const result = await listRemoteCaptures({ endpointUrl: linkedEndpointUrl, apiToken }, { url, signal })
    return result.ok
      ? { ok: true as const, captures: filterLinkedThoughtsForUrl(result.captures, url) }
      : { ok: false as const }
  }, [apiToken, linkedEndpointUrl])

  const refreshLinkedThoughtsForUrl = useCallback((url: string | undefined) => {
    if (!url) return
    if (activeTab?.url === url) {
      linkedThoughtsLoader.refresh(url, loadLinkedThoughts, setLinkedThoughts)
      return
    }
    linkedThoughtsLoader.invalidate(url)
  }, [activeTab?.url, linkedThoughtsLoader, loadLinkedThoughts])

  const saveCapture = useCallback(async () => {
    if (!data || !activeTab) {
      setStatus(t('capture.noActiveTab'))
      return
    }
    if (!canCaptureOnUrl(activeTab.url)) {
      setStatus(t('capture.unsupportedPage'))
      return
    }
    if (!note.trim()) {
      setStatus(t('capture.emptyNote'))
      return
    }

    const memory: UrlMemory = {
      id: createId('memory'),
      projectId: data.activeProjectId,
      url: activeTab.url,
      domain: activeTab.domain,
      surface: activeTab.surface,
      note: note.trim(),
      createdAt: nowIso()
    }

    let outboxItem: CaptureOutboxItem
    try {
      outboxItem = {
        memoryId: memory.id,
        capture: createUrlMemoryCapture(memory, activeTab),
        createdAt: nowIso()
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('capture.createError'))
      return
    }

    const saved: AppData = {
      ...data,
      memories: [memory, ...data.memories],
      sync: { ...data.sync, outbox: [outboxItem, ...data.sync.outbox] }
    }
    try {
      await persist(saved)
    } catch {
      setStatus(t('capture.saveError'))
      return
    }
    setNote('')

    if (!saved.sync.endpointUrl || !apiToken) {
      setStatus(t('capture.savedLocally'))
      return
    }

    const result = await postCapture({ endpointUrl: saved.sync.endpointUrl, apiToken }, outboxItem.capture)
    if (result.ok) refreshLinkedThoughtsForUrl(outboxItem.capture.data.context?.browser?.url)
    const next: AppData = {
      ...saved,
      sync: {
        ...saved.sync,
        outbox: result.ok
          ? saved.sync.outbox.filter((item) => item.capture.id !== outboxItem.capture.id)
          : saved.sync.outbox.map((item) => item.capture.id === outboxItem.capture.id ? { ...item, lastError: result.error } : item)
      }
    }
    try {
      await persist(next)
    } catch {
      setStatus(result.ok ? t('capture.remoteStateSaveError') : t('capture.outboxStateSaveError'))
      return
    }
    setStatus(result.ok ? t('capture.remoteSaved') : t('capture.queued', { error: result.error }))
  }, [activeTab, apiToken, data, note, persist, refreshLinkedThoughtsForUrl, t])

  const selectDeploymentMode = (mode: DeploymentMode) => {
    if (mode === deploymentMode) return
    settingsDirtyRef.current = true
    setDeploymentMode(mode)
    setEndpoint('')
    setApiToken('')
    setTokenInput('')
    setConnectionStatus('')
    setStatus('')
  }

  const markSettingsDirty = () => {
    settingsDirtyRef.current = true
  }

  const markBrainSettingsDirty = () => {
    brainSettingsDirtyRef.current = true
    markSettingsDirty()
  }

  const updateLocalePreference = async (preference: LocalePreference) => {
    if (preference === localePreference) return
    const previousPreference = localePreference
    setLocalePreference(preference)
    try {
      await saveLocalePreference(preference)
      setStatus(createI18n(resolveLocale(preference)).t('settings.languageSaved'))
    } catch {
      setLocalePreference(previousPreference)
      setStatus(tRef.current('settings.languageSaveError'))
    }
  }

  const openSettings = () => {
    settingsDirtyRef.current = false
    brainSettingsDirtyRef.current = false
    setSettingsChangedElsewhere(false)
    setScreen('settings')
  }

  const reloadSettingsForm = () => {
    settingsDirtyRef.current = false
    brainSettingsDirtyRef.current = false
    setSettingsChangedElsewhere(false)
    void refreshStoredSettings({ replaceSettingsForm: true })
  }

  const updateDeveloperMode = async (developerMode: boolean) => {
    if (!data) return
    try {
      await persist({ ...data, sync: { ...data.sync, developerMode } })
    } catch {
      setStatus(t('settings.developerModeSaveError'))
    }
  }

  const startLocalMode = async () => {
    if (!data) return
    const next: AppData = {
      ...data,
      sync: { ...data.sync, mode: 'local', setupComplete: true, endpointUrl: '' }
    }
    try {
      await saveStoredSettings({ data: next, apiToken: '', brainApiToken })
      setData(next)
      setDeploymentMode('local')
      setEndpoint('')
      setApiToken('')
      setTokenInput('')
      settingsDirtyRef.current = false
      brainSettingsDirtyRef.current = false
      setStatus(t('settings.localModeSaved'))
      setScreen('capture')
    } catch {
      setStatus(t('settings.localModeSaveError'))
    }
  }

  const saveSettings = async () => {
    if (!data) return
    try {
      const endpointUrl = endpoint.trim() ? normalizeEndpointUrl(endpoint) : ''
      const modeChanged = deploymentMode !== data.sync.mode
      const nextApiToken = tokenInput.trim() || (modeChanged ? '' : apiToken)
      if (deploymentMode === 'cloudflare' && (!endpointUrl || !nextApiToken)) {
        throw new Error(t('settings.cloudflareRequirements'))
      }
      if ((endpointUrl === '') !== (nextApiToken === '')) {
        throw new Error(t('settings.pairedCredentials'))
      }
      const brainEndpointUrl = brainEndpoint.trim() ? normalizeBrainEndpointUrl(brainEndpoint) : DEFAULT_BRAIN_SERVER_URL
      const nextBrainApiToken = brainTokenInput.trim() || brainApiToken
      const next: AppData = {
        ...data,
        sync: { ...data.sync, mode: deploymentMode, setupComplete: true, endpointUrl, brainEndpointUrl }
      }
      await saveStoredSettings({ data: next, apiToken: nextApiToken, brainApiToken: nextBrainApiToken })
      setData(next)
      setApiToken(nextApiToken)
      setTokenInput('')
      setEndpoint(endpointUrl)
      setBrainApiToken(nextBrainApiToken)
      setBrainTokenInput('')
      setBrainEndpoint(brainEndpointUrl)
      setConnectionStatus('')
      setStatus(endpointUrl && nextApiToken
        ? deploymentMode === 'local' ? t('settings.localConnectionSaved') : t('settings.cloudflareConnectionSaved')
        : t('settings.deviceOnlySaved'))
      settingsDirtyRef.current = false
      brainSettingsDirtyRef.current = false
      setScreen('capture')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('settings.invalidServerAddress'))
    }
  }

  const verifyConnection = async () => {
    if (!data || connectionChecking) return
    setConnectionChecking(true)
    setConnectionStatus(t('settings.connectionSaving'))
    const nextApiToken = tokenInput.trim() || apiToken
    const result = await checkContextServerConnection({ endpointUrl: endpoint, apiToken: nextApiToken })
    if (!result.ok) {
      setConnectionStatus(result.error)
      setConnectionChecking(false)
      return
    }

    try {
      const endpointUrl = normalizeEndpointUrl(endpoint)
      const next: AppData = {
        ...data,
        sync: { ...data.sync, mode: deploymentMode, setupComplete: true, endpointUrl }
      }
      await saveStoredSettings({ data: next, apiToken: nextApiToken, brainApiToken })
      setData(next)
      setEndpoint(endpointUrl)
      setApiToken(nextApiToken)
      setTokenInput('')
    setConnectionStatus(t('settings.connectionSaved'))
      setStatus(deploymentMode === 'local' ? t('settings.localConnectionSaved') : t('settings.cloudflareConnectionSaved'))
      settingsDirtyRef.current = brainSettingsDirtyRef.current
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : t('settings.connectionSaveError'))
    } finally {
      setConnectionChecking(false)
    }
  }

  const clearApiToken = async () => {
    if (!data) return
    try {
      await saveStoredSettings({ data, apiToken: '', brainApiToken })
      setApiToken('')
      setTokenInput('')
      setConnectionStatus('')
      setStatus(t('settings.apiTokenDeleted'))
    } catch {
      setStatus(t('settings.apiTokenDeleteError'))
    }
  }

  const clearBrainApiToken = async () => {
    if (!data) return
    try {
      await saveStoredSettings({ data, apiToken, brainApiToken: '' })
      setBrainApiToken('')
      setBrainTokenInput('')
      setStatus(t('settings.brainTokenDeleted'))
    } catch {
      setStatus(t('settings.brainTokenDeleteError'))
    }
  }

  const retryPending = async () => {
    if (!data?.sync.endpointUrl || !apiToken || data.sync.outbox.length === 0) return
    const config = { endpointUrl: data.sync.endpointUrl, apiToken }
    const results = await Promise.all(data.sync.outbox.map(async (item) => ({ item, result: await postCapture(config, item.capture) })))
    const succeeded = new Set(results.filter(({ result }) => result.ok).map(({ item }) => item.capture.id))
    const failed = new Map(results.filter(({ result }) => !result.ok).map(({ item, result }) => [item.capture.id, result.ok ? '' : result.error]))
    for (const { item, result } of results) {
      if (result.ok) refreshLinkedThoughtsForUrl(item.capture.data.context?.browser?.url)
    }
    try {
      await persist({
        ...data,
        sync: {
          ...data.sync,
          outbox: data.sync.outbox
            .filter((item) => !succeeded.has(item.capture.id))
            .map((item) => failed.has(item.capture.id) ? { ...item, lastError: failed.get(item.capture.id) } : item)
        }
      })
    } catch {
      setStatus(t('capture.pendingStateSaveError'))
      return
    }
    setStatus(succeeded.size === results.length
      ? t('settings.retryAll')
      : t('settings.retrySome', { sent: succeeded.size, pending: results.length - succeeded.size }))
  }

  const loadThoughts = useCallback(async () => {
    if (!data?.sync.endpointUrl || !apiToken) {
      setThoughtStatus(t('thoughts.connectionRequired'))
      setThoughts([])
      return
    }
    setThoughtStatus(t('thoughts.loading'))
    const result = await listRemoteCaptures({ endpointUrl: data.sync.endpointUrl, apiToken })
    if (result.ok) {
      setThoughts(result.captures)
    setThoughtStatus(result.captures.length > 0 ? '' : t('thoughts.empty'))
    } else {
      setThoughts([])
    setThoughtStatus(t('thoughts.loadError', { error: result.error }))
    }
  }, [apiToken, data, t])

  useEffect(() => {
    linkedThoughtsLoader.reset()
    setLinkedThoughts([])
  }, [apiToken, linkedEndpointUrl, linkedThoughtsLoader])

  useEffect(() => () => linkedThoughtsLoader.cancel(), [linkedThoughtsLoader])

  useEffect(() => {
    const currentUrl = activeTab?.url
    if (!currentUrl) {
      linkedThoughtsLoader.cancel()
      setLinkedThoughts([])
      return
    }
    if (activeTabUrlRef.current && activeTabUrlRef.current !== currentUrl && noteRef.current) {
      setNote('')
    setStatus(t('thoughts.linkChanged'))
    }
    activeTabUrlRef.current = currentUrl
    setLinkedThoughts([])
    linkedThoughtsLoader.load(currentUrl, loadLinkedThoughts, setLinkedThoughts)
  }, [activeTab?.url, linkedThoughtsLoader, loadLinkedThoughts, t])

  const openThoughts = () => {
    setThoughtUrlFilter('')
    setScreen('thoughts')
    void loadThoughts()
  }

  const openSummary = () => {
    setSummaryDate(getLocalDate())
    setSummaryStatus('')
    setScreen('summary')
  }

  const createSummary = async () => {
    if (summaryLoading) return
    setSummaryLoading(true)
    setSummaryResult(null)
    setSummaryStatus('')
    try {
      const result = await runDailySummary({ endpointUrl: data?.sync.brainEndpointUrl ?? brainEndpoint, apiToken: brainApiToken }, {
        date: summaryDate,
        timezone: getBrowserTimeZone()
      })
      setSummaryResult(result)
    } catch (error) {
    setSummaryStatus(error instanceof Error ? error.message : t('summary.createError'))
    } finally {
      setSummaryLoading(false)
    }
  }

  const openLinkedThoughts = () => {
    if (!activeTab?.url) return
    setThoughtQuery('')
    setThoughtUrlFilter(activeTab.url)
    setScreen('thoughts')
    void loadThoughts()
  }

  const openThoughtLink = async (url: string | undefined): Promise<ThoughtLinkResult> => {
    if (!url) return 'missing'
    try {
      const destination = new URL(url)
      const isWebLink = destination.protocol === 'http:' || destination.protocol === 'https:'
      const isNewTab = destination.protocol === 'chrome:' && destination.hostname === 'newtab' && destination.pathname === '/'
      const isExtensionsPage = destination.protocol === 'chrome:' && destination.hostname === 'extensions'
      if (!isWebLink && !isNewTab && !isExtensionsPage) return 'invalid'
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        await chrome.tabs.create(isNewTab ? { active: true } : { url: destination.toString(), active: true })
      } else {
        const opened = window.open(isNewTab ? 'about:blank' : destination.toString(), '_blank', 'noopener,noreferrer')
        if (!opened) return 'failed'
      }
      return 'opened'
    } catch {
      return 'failed'
    }
  }

  const resumeThought = async (thought: RemoteCapture) => {
    const linkResult = await openThoughtLink(thought.data.context?.browser?.url)
    setNote(thought.data.content)
    setScreen('capture')
    setStatus(
      linkResult === 'opened'
        ? t('thoughts.resumeOpened')
        : linkResult === 'missing'
          ? t('thoughts.resumeMissing')
          : t('thoughts.resumeFailed')
    )
  }

  const deleteThought = async (thought: RemoteCapture) => {
    if (!data?.sync.endpointUrl || !apiToken || !data.sync.developerMode) return
    if (!window.confirm(t('thoughts.confirmDelete'))) return
    const result = await deleteRemoteCapture({ endpointUrl: data.sync.endpointUrl, apiToken }, thought.id)
    if (result.ok) {
      refreshLinkedThoughtsForUrl(thought.data.context?.browser?.url)
      setThoughts((current) => current.filter((item) => item.id !== thought.id))
      setThoughtStatus(t('thoughts.deleted'))
    } else {
      setThoughtStatus(t('thoughts.deleteError', { error: result.error }))
    }
  }

  const copyThoughts = async (rangeType: ThoughtCopyRange) => {
    const range = getThoughtCopyRange(rangeType, new Date(), copyStart, copyEnd, locale)
    if ('error' in range) {
      setCopyStatus(range.error)
      return
    }

    const matchingThoughts = filterThoughtsForCopy(thoughts, range)
    try {
      await copyTextToClipboard(formatThoughtsForClipboard(matchingThoughts, range.label, locale), locale)
    setCopyStatus(t('thoughts.copySuccess', { label: range.label, count: matchingThoughts.length }))
    } catch (error) {
      setCopyStatus(error instanceof Error ? t('thoughts.copyErrorWithReason', { error: error.message }) : t('thoughts.copyError'))
    }
  }

  if (storageLoadState === 'error') {
    return (
      <main className="capture-shell">
        <section className="capture-card storage-error" role="alert">
          <p className="eyebrow">{t('app.storageErrorEyebrow')}</p>
          <h1>{t('app.storageErrorTitle')}</h1>
          <p>{storageError}</p>
          <button className="primary-button" type="button" onClick={() => void refreshStoredSettings({ initial: true, replaceSettingsForm: true })}>{t('app.retry')}</button>
        </section>
      </main>
    )
  }

  if (storageLoadState !== 'ready' || !data) return <main className="capture-shell"><p>{t('app.storageLoading')}</p></main>

  const canCapture = !activeTab || canCaptureOnUrl(activeTab.url)
  const visibleThoughts = thoughts.filter((thought) =>
    thought.data.content.toLocaleLowerCase().includes(thoughtQuery.trim().toLocaleLowerCase()) &&
    (!thoughtUrlFilter || thought.data.context?.browser?.url === thoughtUrlFilter)
  )

  return (
    <main className={`capture-shell ${surface === 'popup' ? 'is-popup' : ''}`}>
      {screen === 'setup' ? (
        <section className="capture-card setup-card" aria-labelledby="setup-title">
          <header className="capture-header">
            <div><p className="eyebrow">{t('setup.eyebrow')}</p><h1 id="setup-title">{t('setup.title')}</h1></div>
          <Monitor size={20} aria-hidden="true" className="setup-icon" />
          </header>
          <p className="setup-intro">{t('setup.intro')}</p>
          <div className="setup-mode-grid">
            <button className="setup-mode-card" type="button" onClick={() => void startLocalMode()}>
              <Monitor size={19} aria-hidden="true" />
              <span><strong>{t('setup.localTitle')}</strong><small>{t('setup.localDescription')}</small></span>
            </button>
            <button className="setup-mode-card" type="button" onClick={() => { selectDeploymentMode('cloudflare'); setScreen('settings') }}>
              <Cloud size={19} aria-hidden="true" />
              <span><strong>{t('setup.cloudflareTitle')}</strong><small>{t('setup.cloudflareDescription')}</small></span>
            </button>
          </div>
          <p className="help-text">{t('setup.legacyHint')}</p>
        </section>
      ) : screen === 'settings' ? (
        <section className="capture-card" aria-labelledby="settings-title">
          <header className="capture-header">
            <button className="icon-button" type="button" aria-label={t('app.backToCapture')} onClick={() => setScreen('capture')}><ArrowLeft size={17} /></button>
            <div><p className="eyebrow">Context OS</p><h1 id="settings-title">{t('settings.title')}</h1></div>
          </header>
          {settingsChangedElsewhere ? <div className="settings-conflict" role="status"><span>{t('settings.conflict')}</span><button type="button" onClick={reloadSettingsForm}>{t('settings.reload')}</button></div> : null}
          <div className="settings-section-heading"><p className="eyebrow">{t('settings.languageEyebrow')}</p><h2>{t('settings.languageTitle')}</h2></div>
          <label className="capture-field">
            <span>{t('settings.languageLabel')}</span>
            <select value={localePreference} onChange={(event) => void updateLocalePreference(event.target.value as LocalePreference)}>
              <option value="auto">{t('settings.languageAuto')}</option>
              <option value="ko">{t('settings.languageKorean')}</option>
              <option value="en">{t('settings.languageEnglish')}</option>
            </select>
          </label>
          <div className="settings-section-heading"><p className="eyebrow">{t('settings.storageEyebrow')}</p><h2>{t('settings.storageTitle')}</h2></div>
          <div className="mode-picker" role="radiogroup" aria-label={t('settings.operationMode')}>
            <label className={`mode-option ${deploymentMode === 'local' ? 'is-selected' : ''}`}>
              <input type="radio" name="deployment-mode" checked={deploymentMode === 'local'} onChange={() => selectDeploymentMode('local')} />
              <Monitor size={17} aria-hidden="true" />
              <span><strong>{t('settings.local')}</strong><small>{t('settings.localDescription')}</small></span>
            </label>
            <label className={`mode-option ${deploymentMode === 'cloudflare' ? 'is-selected' : ''}`}>
              <input type="radio" name="deployment-mode" checked={deploymentMode === 'cloudflare'} onChange={() => selectDeploymentMode('cloudflare')} />
              <Cloud size={17} aria-hidden="true" />
              <span><strong>{t('settings.cloudflare')}</strong><small>{t('settings.cloudflareDescription')}</small></span>
            </label>
          </div>
          <p className="help-text">{deploymentMode === 'local' ? t('settings.localHelp') : t('settings.cloudflareHelp')}</p>
          <label className="capture-field">
            <span>{deploymentMode === 'local' ? t('settings.localEndpoint') : t('settings.cloudflareEndpoint')}</span>
            <input value={endpoint} onChange={(event) => { markSettingsDirty(); setEndpoint(event.target.value); setConnectionStatus('') }} placeholder={deploymentMode === 'local' ? 'http://127.0.0.1:17001' : 'https://context.example.com'} inputMode="url" />
          </label>
          <label className="capture-field settings-token-field">
            <span>{t('settings.apiToken')}</span>
            <input
              type="password"
              value={tokenInput}
              onChange={(event) => { markSettingsDirty(); setTokenInput(event.target.value); setConnectionStatus('') }}
              placeholder={apiToken ? t('settings.apiTokenConfiguredPlaceholder') : t('settings.apiTokenPlaceholder')}
              autoComplete="new-password"
              spellCheck={false}
            />
          </label>
          <p className="secret-status" role="status"><strong>{t('settings.apiToken')}</strong>{apiToken ? ` ${t('settings.configured')}` : ` ${t('settings.notConfigured')}`}</p>
          <p className="help-text">{t('settings.tokenStorageHelp')}</p>
          {endpoint.trim() || tokenInput.trim() || apiToken ? <button className="secondary-button" type="button" disabled={connectionChecking} onClick={() => void verifyConnection()}>{connectionChecking ? <><RefreshCw size={17} className="spin" />{t('settings.connectionSaving')}</> : <><RefreshCw size={17} />{t('settings.verifyAndSave')}</>}</button> : null}
          {connectionStatus ? <p className="connection-status" role="status">{connectionStatus}</p> : null}
          {endpoint.trim() || tokenInput.trim() || apiToken ? <p className="help-text">{t('settings.applyHelp')}</p> : null}
          <div className="settings-divider" />
          <div className="settings-section-heading"><p className="eyebrow">{t('settings.intelligenceEyebrow')}</p><h2>{t('settings.brainServer')}</h2></div>
          <label className="capture-field">
            <span>{t('settings.brainEndpoint')}</span>
            <input value={brainEndpoint} onChange={(event) => { markBrainSettingsDirty(); setBrainEndpoint(event.target.value) }} placeholder="http://127.0.0.1:17002" inputMode="url" />
          </label>
          <label className="capture-field settings-token-field">
            <span>{t('settings.brainApiToken')}</span>
            <input
              type="password"
              value={brainTokenInput}
              onChange={(event) => { markBrainSettingsDirty(); setBrainTokenInput(event.target.value) }}
              placeholder={brainApiToken ? t('settings.apiTokenConfiguredPlaceholder') : t('settings.optional')}
              autoComplete="new-password"
              spellCheck={false}
            />
          </label>
          <p className="secret-status" role="status"><strong>Brain token</strong>{brainApiToken ? ` ${t('settings.configured')}` : ` ${t('settings.brainTokenOptional')}`}</p>
          <p className="help-text">{t('settings.brainHelp')}</p>
          <label className="developer-mode">
            <input
              type="checkbox"
              checked={data.sync.developerMode}
              onChange={(event) => void updateDeveloperMode(event.target.checked)}
            />
            <span><strong>{t('settings.developerMode')}</strong>{t('settings.developerModeDescription')}</span>
          </label>
          <button className="primary-button" type="button" onClick={() => void saveSettings()}><Check size={17} />{t('settings.save')}</button>
          {apiToken ? <button className="danger-button" type="button" onClick={() => void clearApiToken()}>{t('settings.deleteApiToken')}</button> : null}
          {brainApiToken ? <button className="danger-button" type="button" onClick={() => void clearBrainApiToken()}>{t('settings.deleteBrainToken')}</button> : null}
          {data.sync.outbox.length > 0 ? <button className="secondary-button" type="button" onClick={() => void retryPending()}><Cloud size={17} />{t('settings.retryPending', { count: data.sync.outbox.length })}</button> : null}
        </section>
      ) : screen === 'summary' ? (
        <section className="capture-card" aria-labelledby="summary-title">
          <header className="capture-header">
            <button className="icon-button" type="button" aria-label={t('app.backToCapture')} onClick={() => setScreen('capture')}><ArrowLeft size={17} /></button>
            <div><p className="eyebrow">{t('settings.brainServer')}</p><h1 id="summary-title">{t('summary.title')}</h1></div>
            <Sparkles size={20} aria-hidden="true" className="summary-icon" />
          </header>
          <label className="capture-field summary-date-field">
            <span><CalendarDays size={14} aria-hidden="true" />{t('summary.date')} · {getBrowserTimeZone()}</span>
            <input type="date" value={summaryDate} onChange={(event) => { setSummaryDate(event.target.value); setSummaryResult(null); setSummaryStatus('') }} />
          </label>
          <p className="summary-intro">{t('summary.intro')}</p>
          <button className="primary-button" type="button" onClick={() => void createSummary()} disabled={summaryLoading || !summaryDate}>
            {summaryLoading ? <><Sparkles size={17} className="spin" />{t('summary.loading')}</> : <><Sparkles size={17} />{t('summary.create')}</>}
          </button>
          {summaryStatus ? <p className="summary-error" role="alert">{summaryStatus}</p> : null}
          {summaryResult ? (
            <section className={`summary-result ${summaryResult.recordCount === 0 ? 'is-empty' : ''}`} aria-live="polite">
              <div className="summary-result-meta"><span>{summaryResult.recordCount === 0 ? t('summary.noRecords') : t('summary.recordCount', { count: summaryResult.recordCount })}</span><span>{summaryResult.date} · {summaryResult.timezone}</span></div>
              <p className="summary-text">{summaryResult.summary}</p>
              {summaryResult.keyPoints.length > 0 ? <div className="summary-points"><h2>{t('summary.keyPoints')}</h2><ul>{summaryResult.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul></div> : <p className="summary-empty-help">{t('summary.emptyHelp')}</p>}
            </section>
          ) : null}
        </section>
      ) : screen === 'thoughts' ? (
        <section className="capture-card" aria-labelledby="thoughts-title">
          <header className="capture-header">
            <button className="icon-button" type="button" aria-label={t('app.backToCapture')} onClick={() => setScreen('capture')}><ArrowLeft size={17} /></button>
            <div><p className="eyebrow">Context Server</p><h1 id="thoughts-title">{t('thoughts.title')}</h1></div>
            <button className="icon-button" type="button" aria-label={t('thoughts.refresh')} onClick={() => void loadThoughts()}><RefreshCw size={17} /></button>
          </header>
          <label className="capture-field search-field">
            <span>{t('thoughts.search')}</span>
            <div><Search size={17} aria-hidden="true" /><input value={thoughtQuery} onChange={(event) => setThoughtQuery(event.target.value)} placeholder={t('thoughts.searchPlaceholder')} /></div>
          </label>
          {thoughtUrlFilter ? <div className="link-filter"><Link2 size={14} /><span>{t('thoughts.filteredByLink')}</span><button type="button" onClick={() => setThoughtUrlFilter('')}>{t('thoughts.showAll')}</button></div> : null}
          <section className="copy-thoughts" aria-labelledby="copy-thoughts-title">
            <div className="copy-thoughts-heading"><div><p className="eyebrow">{t('thoughts.externalUse')}</p><h2 id="copy-thoughts-title">{t('thoughts.copyTitle')}</h2></div><Copy size={18} aria-hidden="true" /></div>
            <p>{t('thoughts.copyDescription')}</p>
            <div className="copy-range-actions">
              <button type="button" onClick={() => void copyThoughts('today')}>{t('thoughts.copyToday')}</button>
              <button type="button" onClick={() => void copyThoughts('week')}>{t('thoughts.copyWeek')}</button>
              <button type="button" onClick={() => void copyThoughts('month')}>{t('thoughts.copyMonth')}</button>
              <button type="button" onClick={() => void copyThoughts('all')}>{t('thoughts.copyAll')}</button>
            </div>
            <div className="custom-copy-range">
              <label><span>{t('thoughts.startDate')}</span><input type="date" value={copyStart} onChange={(event) => setCopyStart(event.target.value)} /></label>
              <span aria-hidden="true">–</span>
              <label><span>{t('thoughts.endDate')}</span><input type="date" value={copyEnd} onChange={(event) => setCopyEnd(event.target.value)} /></label>
              <button type="button" onClick={() => void copyThoughts('custom')}>{t('thoughts.copySelected')}</button>
            </div>
            {copyStatus ? <p className="copy-status" role="status">{copyStatus}</p> : null}
          </section>
          <div className="thought-list" aria-live="polite">
            {visibleThoughts.map((thought) => (
              <article className="thought-row" key={thought.id}>
                <button className="thought-content" type="button" onClick={() => resumeThought(thought)}>
                  {thought.data.context?.browser?.url ? <Link2 size={16} aria-label={t('thoughts.linked')} /> : null}
                  <p>{thought.data.content}</p>
                  <footer>{formatDate(new Date(thought.recordedAt), { dateStyle: 'medium', timeStyle: 'short' })}{thought.data.context?.browser?.title ? ` · ${thought.data.context.browser.title}` : ''}</footer>
                </button>
                {data.sync.developerMode ? <button className="delete-button" type="button" onClick={() => void deleteThought(thought)}><Trash2 size={14} />{t('thoughts.delete')}</button> : null}
              </article>
            ))}
          </div>
          {thoughtStatus ? <p className="help-text">{thoughtStatus}</p> : null}
          {!thoughtStatus && thoughts.length > 0 && visibleThoughts.length === 0 ? <p className="help-text">{t('thoughts.noMatch')}</p> : null}
        </section>
      ) : (
        <section className="capture-card" aria-labelledby="capture-title">
          <header className="capture-header">
            <div><p className="eyebrow">Context OS</p><h1 id="capture-title">{t('capture.title')}</h1></div>
            <div className="header-actions"><button className="summary-entry-button" type="button" onClick={openSummary}><Sparkles size={15} />{t('capture.summary')}</button><button className="icon-button" type="button" aria-label={t('capture.searchThoughts')} onClick={openThoughts}><Search size={17} /></button><button className="icon-button" type="button" aria-label={t('capture.settings')} onClick={openSettings}><Settings size={17} /></button></div>
          </header>
          <div className="source-row">
            <Link2 size={17} aria-hidden="true" />
            <div><span>{t('capture.currentLink')}</span><strong>{activeTab?.title || t('capture.loadingTab')}</strong><code>{activeTab?.url || ''}</code></div>
          </div>
          {linkedThoughts.length > 0 ? <button className="related-thought" type="button" onClick={openLinkedThoughts}><span>{t('capture.relatedExists')}</span><p>{linkedThoughts[0].data.content}</p><small>{t('capture.viewLinkThoughts')}</small></button> : null}
          <label className="capture-field">
            <span>{t('capture.note')}</span>
            <textarea
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void saveCapture() } }}
              placeholder={t('capture.notePlaceholder')}
            />
          </label>
          <button className="primary-button" type="button" disabled={!canCapture} onClick={() => void saveCapture()}>{canCapture ? <><Send size={17} />{t('capture.save')}</> : t('capture.unsupportedPageButton')}</button>
          <p className="shortcut">{t('capture.shortcut')}</p>
        </section>
      )}
      {status ? <p className="capture-status" role="status">{status}</p> : null}
    </main>
  )
}
