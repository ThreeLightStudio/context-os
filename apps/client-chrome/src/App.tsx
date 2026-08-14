import { ArrowLeft, CalendarDays, Check, Cloud, Copy, Link2, Monitor, RefreshCw, Search, Send, Settings, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getActiveTab, subscribeToActiveTab } from './chromeApi'
import { getBrowserTimeZone, getLocalDate, normalizeBrainEndpointUrl, runDailySummary } from './brainCapture'
import type { DailySummaryResult } from './brainCapture'
import { DEFAULT_BRAIN_SERVER_URL } from './config'
import { checkContextServerConnection, createUrlMemoryCapture, deleteRemoteCapture, listRemoteCaptures, normalizeEndpointUrl, postCapture } from './contextCapture'
import type { RemoteCapture } from './contextCapture'
import { filterLinkedThoughtsForUrl, LinkedThoughtsLoader } from './linkedThoughts'
import { loadStoredSettings, saveAppData, saveStoredSettings, subscribeToStoredSettingsChanges } from './storage'
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
  const settingsDirtyRef = useRef(false)
  const brainSettingsDirtyRef = useRef(false)
  const linkedThoughtsLoaderRef = useRef<LinkedThoughtsLoader | null>(null)
  if (!linkedThoughtsLoaderRef.current) linkedThoughtsLoaderRef.current = new LinkedThoughtsLoader()
  const linkedThoughtsLoader = linkedThoughtsLoaderRef.current

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
      setStorageError('저장된 설정을 불러오지 못했습니다. 기존 데이터를 보호하기 위해 새 설정을 시작하지 않았습니다.')
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

  const invalidateLinkedThoughtsForUrl = useCallback((url: string | undefined) => {
    linkedThoughtsLoader.invalidate(url)
  }, [linkedThoughtsLoader])

  const saveCapture = useCallback(async () => {
    if (!data || !activeTab) {
      setStatus('현재 탭을 읽을 수 없습니다. 일반 웹페이지를 열어 주세요.')
      return
    }
    if (!canCaptureOnUrl(activeTab.url)) {
      setStatus('새 탭을 제외한 Chrome 내부 페이지에서는 기록할 수 없습니다.')
      return
    }
    if (!note.trim()) {
      setStatus('먼저 짧은 메모를 입력해 주세요.')
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
      setStatus(error instanceof Error ? error.message : 'Capture를 만들지 못했습니다.')
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
      setStatus('이 기기에 기록을 저장하지 못했습니다. Chrome 저장소를 확인한 뒤 다시 시도해 주세요.')
      return
    }
    setNote('')

    if (!saved.sync.endpointUrl || !apiToken) {
      setStatus('이 기기에 저장했습니다. 로컬 Context Server 또는 Cloudflare D1을 연결하면 전송할 수 있습니다.')
      return
    }

    const result = await postCapture({ endpointUrl: saved.sync.endpointUrl, apiToken }, outboxItem.capture)
    if (result.ok) invalidateLinkedThoughtsForUrl(outboxItem.capture.data.context?.browser?.url)
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
      setStatus(result.ok
        ? '서버에는 기록했지만 이 기기의 상태를 저장하지 못했습니다. 다시 열어 전송 대기를 확인해 주세요.'
        : '전송 대기 상태를 저장하지 못했습니다. Chrome 저장소를 확인한 뒤 다시 시도해 주세요.')
      return
    }
    setStatus(result.ok ? 'Context Server에 기록했습니다.' : `로컬에 저장했습니다. 전송 대기: ${result.error}`)
  }, [activeTab, apiToken, data, invalidateLinkedThoughtsForUrl, note, persist])

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
      setStatus('개발자 모드 변경을 저장하지 못했습니다. Chrome 저장소를 확인한 뒤 다시 시도해 주세요.')
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
      setStatus('이 기기에만 기록을 저장합니다. Raycast와 함께 쓰려면 연결 설정에서 로컬 Context Server를 추가하세요.')
      setScreen('capture')
    } catch {
      setStatus('로컬 모드 설정을 저장하지 못했습니다. Chrome 저장소를 확인한 뒤 다시 시도해 주세요.')
    }
  }

  const saveSettings = async () => {
    if (!data) return
    try {
      const endpointUrl = endpoint.trim() ? normalizeEndpointUrl(endpoint) : ''
      const modeChanged = deploymentMode !== data.sync.mode
      const nextApiToken = tokenInput.trim() || (modeChanged ? '' : apiToken)
      if (deploymentMode === 'cloudflare' && (!endpointUrl || !nextApiToken)) {
        throw new Error('Cloudflare D1 모드에는 Context Server URL과 read/write API token이 필요합니다.')
      }
      if ((endpointUrl === '') !== (nextApiToken === '')) {
        throw new Error('Context Server URL과 API token은 함께 입력해 주세요.')
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
        ? deploymentMode === 'local' ? '로컬 Context Server 연결 설정을 저장했습니다.' : 'Cloudflare D1 연결 설정을 저장했습니다.'
        : '이 기기에만 기록을 저장합니다. 필요할 때 로컬 Context Server를 연결할 수 있습니다.')
      settingsDirtyRef.current = false
      brainSettingsDirtyRef.current = false
      setScreen('capture')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '서버 주소를 확인해 주세요.')
    }
  }

  const verifyConnection = async () => {
    if (!data || connectionChecking) return
    setConnectionChecking(true)
    setConnectionStatus('연결을 확인하고 저장하는 중…')
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
      setConnectionStatus('연결을 확인하고 저장했습니다. API token에 read 권한이 있습니다.')
      setStatus(deploymentMode === 'local' ? '로컬 Context Server 연결 설정을 저장했습니다.' : 'Cloudflare D1 연결 설정을 저장했습니다.')
      settingsDirtyRef.current = brainSettingsDirtyRef.current
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : '연결 설정을 저장하지 못했습니다.')
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
      setStatus('API token을 삭제했습니다. 로컬 저장은 계속 사용할 수 있습니다.')
    } catch {
      setStatus('API token을 삭제하지 못했습니다. Chrome 저장소를 확인한 뒤 다시 시도해 주세요.')
    }
  }

  const clearBrainApiToken = async () => {
    if (!data) return
    try {
      await saveStoredSettings({ data, apiToken, brainApiToken: '' })
      setBrainApiToken('')
      setBrainTokenInput('')
      setStatus('Brain Server API token을 삭제했습니다.')
    } catch {
      setStatus('Brain Server API token을 삭제하지 못했습니다. Chrome 저장소를 확인한 뒤 다시 시도해 주세요.')
    }
  }

  const retryPending = async () => {
    if (!data?.sync.endpointUrl || !apiToken || data.sync.outbox.length === 0) return
    const config = { endpointUrl: data.sync.endpointUrl, apiToken }
    const results = await Promise.all(data.sync.outbox.map(async (item) => ({ item, result: await postCapture(config, item.capture) })))
    const succeeded = new Set(results.filter(({ result }) => result.ok).map(({ item }) => item.capture.id))
    const failed = new Map(results.filter(({ result }) => !result.ok).map(({ item, result }) => [item.capture.id, result.ok ? '' : result.error]))
    for (const { item, result } of results) {
      if (result.ok) invalidateLinkedThoughtsForUrl(item.capture.data.context?.browser?.url)
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
      setStatus('전송 결과를 이 기기에 저장하지 못했습니다. Chrome 저장소를 확인한 뒤 다시 시도해 주세요.')
      return
    }
    setStatus(succeeded.size === results.length ? '대기 중인 기록을 모두 전송했습니다.' : `${succeeded.size}건 전송, ${results.length - succeeded.size}건 대기 중입니다.`)
  }

  const loadThoughts = useCallback(async () => {
    if (!data?.sync.endpointUrl || !apiToken) {
      setThoughtStatus('로컬 Context Server 또는 Cloudflare D1 연결을 먼저 설정해 주세요.')
      setThoughts([])
      return
    }
    setThoughtStatus('생각을 불러오는 중…')
    const result = await listRemoteCaptures({ endpointUrl: data.sync.endpointUrl, apiToken })
    if (result.ok) {
      setThoughts(result.captures)
      setThoughtStatus(result.captures.length > 0 ? '' : '저장된 생각이 아직 없습니다.')
    } else {
      setThoughts([])
      setThoughtStatus(`생각을 불러오지 못했습니다: ${result.error}`)
    }
  }, [apiToken, data])

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
      setStatus('현재 링크가 바뀌어 작성 중인 메모를 비웠습니다.')
    }
    activeTabUrlRef.current = currentUrl
    setLinkedThoughts([])
    linkedThoughtsLoader.load(currentUrl, loadLinkedThoughts, setLinkedThoughts)
  }, [activeTab?.url, linkedThoughtsLoader, loadLinkedThoughts])

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
      setSummaryStatus(error instanceof Error ? error.message : 'Daily Summary를 만들지 못했습니다.')
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
        ? '링크를 새 탭에서 열고, 메모를 작성 화면에 불러왔습니다.'
        : linkResult === 'missing'
          ? '연결된 링크가 없어 메모만 작성 화면에 불러왔습니다.'
          : '링크를 열지 못해 메모만 작성 화면에 불러왔습니다.'
    )
  }

  const deleteThought = async (thought: RemoteCapture) => {
    if (!data?.sync.endpointUrl || !apiToken || !data.sync.developerMode) return
    if (!window.confirm('이 Record를 Context Server에서 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return
    const result = await deleteRemoteCapture({ endpointUrl: data.sync.endpointUrl, apiToken }, thought.id)
    if (result.ok) {
      invalidateLinkedThoughtsForUrl(thought.data.context?.browser?.url)
      setThoughts((current) => current.filter((item) => item.id !== thought.id))
      setThoughtStatus('Record를 삭제했습니다.')
    } else {
      setThoughtStatus(`삭제하지 못했습니다: ${result.error}`)
    }
  }

  const copyThoughts = async (rangeType: ThoughtCopyRange) => {
    const range = getThoughtCopyRange(rangeType, new Date(), copyStart, copyEnd)
    if ('error' in range) {
      setCopyStatus(range.error)
      return
    }

    const matchingThoughts = filterThoughtsForCopy(thoughts, range)
    try {
      await copyTextToClipboard(formatThoughtsForClipboard(matchingThoughts, range.label))
      setCopyStatus(`${range.label} ${matchingThoughts.length}개를 클립보드에 복사했습니다.`)
    } catch (error) {
      setCopyStatus(error instanceof Error ? `복사하지 못했습니다: ${error.message}` : '복사하지 못했습니다. 브라우저 권한을 확인해 주세요.')
    }
  }

  if (storageLoadState === 'error') {
    return (
      <main className="capture-shell">
        <section className="capture-card storage-error" role="alert">
          <p className="eyebrow">Storage protection</p>
          <h1>저장된 설정을 열지 못했습니다</h1>
          <p>{storageError}</p>
          <button className="primary-button" type="button" onClick={() => void refreshStoredSettings({ initial: true, replaceSettingsForm: true })}>다시 시도</button>
        </section>
      </main>
    )
  }

  if (storageLoadState !== 'ready' || !data) return <main className="capture-shell"><p>Context OS를 여는 중…</p></main>

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
            <div><p className="eyebrow">Context OS</p><h1 id="setup-title">데이터 보관 방식 선택</h1></div>
          <Monitor size={20} aria-hidden="true" className="setup-icon" />
          </header>
          <p className="setup-intro">기록을 이 기기에만 보관하거나, 내 Cloudflare D1에 동기화할 수 있습니다. 언제든 연결 설정에서 바꿀 수 있어요.</p>
          <div className="setup-mode-grid">
            <button className="setup-mode-card" type="button" onClick={() => void startLocalMode()}>
              <Monitor size={19} aria-hidden="true" />
              <span><strong>로컬로 시작</strong><small>Chrome 로컬 저장으로 바로 사용합니다. Raycast와 함께 쓰려면 나중에 로컬 Context Server를 연결하세요.</small></span>
            </button>
            <button className="setup-mode-card" type="button" onClick={() => { selectDeploymentMode('cloudflare'); setScreen('settings') }}>
              <Cloud size={19} aria-hidden="true" />
              <span><strong>Cloudflare D1 연결</strong><small>내 Cloudflare Worker URL과 API token을 입력해 여러 클라이언트에서 기록을 사용합니다.</small></span>
            </button>
          </div>
          <p className="help-text">이전 버전에서 연결이 초기화되었다면 Cloudflare 주소와 token을 한 번 다시 입력해 주세요.</p>
        </section>
      ) : screen === 'settings' ? (
        <section className="capture-card" aria-labelledby="settings-title">
          <header className="capture-header">
            <button className="icon-button" type="button" aria-label="메모 화면으로 돌아가기" onClick={() => setScreen('capture')}><ArrowLeft size={17} /></button>
            <div><p className="eyebrow">Context OS</p><h1 id="settings-title">연결 설정</h1></div>
          </header>
          {settingsChangedElsewhere ? <div className="settings-conflict" role="status"><span>다른 화면에서 저장된 설정이 있습니다. 현재 입력을 유지하고 있습니다.</span><button type="button" onClick={reloadSettingsForm}>저장값 다시 불러오기</button></div> : null}
          <div className="settings-section-heading"><p className="eyebrow">Storage</p><h2>운영 방식</h2></div>
          <div className="mode-picker" role="radiogroup" aria-label="운영 방식">
            <label className={`mode-option ${deploymentMode === 'local' ? 'is-selected' : ''}`}>
              <input type="radio" name="deployment-mode" checked={deploymentMode === 'local'} onChange={() => selectDeploymentMode('local')} />
              <Monitor size={17} aria-hidden="true" />
              <span><strong>로컬</strong><small>이 기기 또는 로컬 Worker/D1</small></span>
            </label>
            <label className={`mode-option ${deploymentMode === 'cloudflare' ? 'is-selected' : ''}`}>
              <input type="radio" name="deployment-mode" checked={deploymentMode === 'cloudflare'} onChange={() => selectDeploymentMode('cloudflare')} />
              <Cloud size={17} aria-hidden="true" />
              <span><strong>Cloudflare D1</strong><small>내 Worker와 D1 데이터베이스</small></span>
            </label>
          </div>
          <p className="help-text">{deploymentMode === 'local'
            ? 'Chrome만 사용할 때는 아래 값을 비워 두세요. Raycast와 공유하려면 로컬 Context Server 주소와 token을 함께 입력합니다.'
            : 'Cloudflare에 배포한 내 Context Server URL과 read/write API token을 입력합니다.'}</p>
          <label className="capture-field">
            <span>{deploymentMode === 'local' ? '로컬 Context Server 주소 (선택)' : 'Cloudflare Context Server 주소'}</span>
            <input value={endpoint} onChange={(event) => { markSettingsDirty(); setEndpoint(event.target.value); setConnectionStatus('') }} placeholder={deploymentMode === 'local' ? 'http://127.0.0.1:8787' : 'https://context.example.com'} inputMode="url" />
          </label>
          <label className="capture-field settings-token-field">
            <span>API token</span>
            <input
              type="password"
              value={tokenInput}
              onChange={(event) => { markSettingsDirty(); setTokenInput(event.target.value); setConnectionStatus('') }}
              placeholder={apiToken ? '설정됨 — 변경할 때만 입력' : 'Read/write API token'}
              autoComplete="new-password"
              spellCheck={false}
            />
          </label>
          <p className="secret-status" role="status"><strong>API token</strong>{apiToken ? 'Configured. 비밀 토큰은 표시하지 않습니다.' : 'Not configured. 서버 연결을 위해 입력해 주세요.'}</p>
          <p className="help-text">token은 백업 데이터와 화면에 포함하지 않고 이 확장 프로그램의 로컬 저장소에만 보관합니다.</p>
          {endpoint.trim() || tokenInput.trim() || apiToken ? <button className="secondary-button" type="button" disabled={connectionChecking} onClick={() => void verifyConnection()}>{connectionChecking ? <><RefreshCw size={17} className="spin" />연결 확인 및 저장 중…</> : <><RefreshCw size={17} />연결 확인 및 저장</>}</button> : null}
          {connectionStatus ? <p className="connection-status" role="status">{connectionStatus}</p> : null}
          {endpoint.trim() || tokenInput.trim() || apiToken ? <p className="help-text">연결 확인에 성공하면 Context Server 주소와 API token을 바로 적용합니다.</p> : null}
          <div className="settings-divider" />
          <div className="settings-section-heading"><p className="eyebrow">Intelligence</p><h2>Brain Server</h2></div>
          <label className="capture-field">
            <span>Brain Server 주소</span>
            <input value={brainEndpoint} onChange={(event) => { markBrainSettingsDirty(); setBrainEndpoint(event.target.value) }} placeholder="http://127.0.0.1:8788" inputMode="url" />
          </label>
          <label className="capture-field settings-token-field">
            <span>Brain Server API token</span>
            <input
              type="password"
              value={brainTokenInput}
              onChange={(event) => { markBrainSettingsDirty(); setBrainTokenInput(event.target.value) }}
              placeholder={brainApiToken ? '설정됨 — 변경할 때만 입력' : '선택 사항'}
              autoComplete="new-password"
              spellCheck={false}
            />
          </label>
          <p className="secret-status" role="status"><strong>Brain token</strong>{brainApiToken ? 'Configured. 비밀 토큰은 표시하지 않습니다.' : 'Optional. 로컬 Brain Server가 인증 없이 실행 중이면 비워 두세요.'}</p>
          <p className="help-text">Daily Summary는 이 주소의 Brain Server가 Context Server 기록을 조회하고 요약합니다.</p>
          <label className="developer-mode">
            <input
              type="checkbox"
              checked={data.sync.developerMode}
              onChange={(event) => void updateDeveloperMode(event.target.checked)}
            />
            <span><strong>개발자 모드</strong>테스트·Mock Record 삭제 버튼을 표시합니다.</span>
          </label>
          <button className="primary-button" type="button" onClick={() => void saveSettings()}><Check size={17} />연결 설정 저장</button>
          {apiToken ? <button className="danger-button" type="button" onClick={() => void clearApiToken()}>API token 삭제</button> : null}
          {brainApiToken ? <button className="danger-button" type="button" onClick={() => void clearBrainApiToken()}>Brain token 삭제</button> : null}
          {data.sync.outbox.length > 0 ? <button className="secondary-button" type="button" onClick={() => void retryPending()}><Cloud size={17} />전송 대기 {data.sync.outbox.length}건 다시 시도</button> : null}
        </section>
      ) : screen === 'summary' ? (
        <section className="capture-card" aria-labelledby="summary-title">
          <header className="capture-header">
            <button className="icon-button" type="button" aria-label="메모 화면으로 돌아가기" onClick={() => setScreen('capture')}><ArrowLeft size={17} /></button>
            <div><p className="eyebrow">Brain Server</p><h1 id="summary-title">오늘 요약</h1></div>
            <Sparkles size={20} aria-hidden="true" className="summary-icon" />
          </header>
          <label className="capture-field summary-date-field">
            <span><CalendarDays size={14} aria-hidden="true" />요약 날짜 · {getBrowserTimeZone()}</span>
            <input type="date" value={summaryDate} onChange={(event) => { setSummaryDate(event.target.value); setSummaryResult(null); setSummaryStatus('') }} />
          </label>
          <p className="summary-intro">선택한 날짜의 Context 기록을 가져와 짧게 정리합니다.</p>
          <button className="primary-button" type="button" onClick={() => void createSummary()} disabled={summaryLoading || !summaryDate}>
            {summaryLoading ? <><Sparkles size={17} className="spin" />요약을 만드는 중…</> : <><Sparkles size={17} />요약 생성</>}
          </button>
          {summaryStatus ? <p className="summary-error" role="alert">{summaryStatus}</p> : null}
          {summaryResult ? (
            <section className={`summary-result ${summaryResult.recordCount === 0 ? 'is-empty' : ''}`} aria-live="polite">
              <div className="summary-result-meta"><span>{summaryResult.recordCount === 0 ? '기록 없음' : `Context 기록 ${summaryResult.recordCount}개`}</span><span>{summaryResult.date} · {summaryResult.timezone}</span></div>
              <p className="summary-text">{summaryResult.summary}</p>
              {summaryResult.keyPoints.length > 0 ? <div className="summary-points"><h2>핵심 포인트</h2><ul>{summaryResult.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul></div> : <p className="summary-empty-help">먼저 생각을 남기면 이 날짜의 요약이 여기에 나타납니다.</p>}
            </section>
          ) : null}
        </section>
      ) : screen === 'thoughts' ? (
        <section className="capture-card" aria-labelledby="thoughts-title">
          <header className="capture-header">
            <button className="icon-button" type="button" aria-label="메모 화면으로 돌아가기" onClick={() => setScreen('capture')}><ArrowLeft size={17} /></button>
            <div><p className="eyebrow">Context Server</p><h1 id="thoughts-title">생각 전체 조회</h1></div>
            <button className="icon-button" type="button" aria-label="생각 새로고침" onClick={() => void loadThoughts()}><RefreshCw size={17} /></button>
          </header>
          <label className="capture-field search-field">
            <span>생각 검색</span>
            <div><Search size={17} aria-hidden="true" /><input value={thoughtQuery} onChange={(event) => setThoughtQuery(event.target.value)} placeholder="기억나는 단어를 입력하세요" /></div>
          </label>
          {thoughtUrlFilter ? <div className="link-filter"><Link2 size={14} /><span>현재 링크의 기록만 표시 중</span><button type="button" onClick={() => setThoughtUrlFilter('')}>전체 보기</button></div> : null}
          <section className="copy-thoughts" aria-labelledby="copy-thoughts-title">
            <div className="copy-thoughts-heading"><div><p className="eyebrow">External use</p><h2 id="copy-thoughts-title">생각 복사</h2></div><Copy size={18} aria-hidden="true" /></div>
            <p>시간, 원문, 연결한 링크를 함께 복사합니다.</p>
            <div className="copy-range-actions">
              <button type="button" onClick={() => void copyThoughts('today')}>오늘 기록 복사</button>
              <button type="button" onClick={() => void copyThoughts('week')}>이번 주 기록 복사</button>
              <button type="button" onClick={() => void copyThoughts('month')}>이번 달 기록 복사</button>
              <button type="button" onClick={() => void copyThoughts('all')}>전체 생각 복사</button>
            </div>
            <div className="custom-copy-range">
              <label><span>시작일</span><input type="date" value={copyStart} onChange={(event) => setCopyStart(event.target.value)} /></label>
              <span aria-hidden="true">–</span>
              <label><span>종료일</span><input type="date" value={copyEnd} onChange={(event) => setCopyEnd(event.target.value)} /></label>
              <button type="button" onClick={() => void copyThoughts('custom')}>선택 기간 복사</button>
            </div>
            {copyStatus ? <p className="copy-status" role="status">{copyStatus}</p> : null}
          </section>
          <div className="thought-list" aria-live="polite">
            {visibleThoughts.map((thought) => (
              <article className="thought-row" key={thought.id}>
                <button className="thought-content" type="button" onClick={() => resumeThought(thought)}>
                  {thought.data.context?.browser?.url ? <Link2 size={16} aria-label="연결된 링크 있음" /> : null}
                  <p>{thought.data.content}</p>
                  <footer>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(thought.recordedAt))}{thought.data.context?.browser?.title ? ` · ${thought.data.context.browser.title}` : ''}</footer>
                </button>
                {data.sync.developerMode ? <button className="delete-button" type="button" onClick={() => void deleteThought(thought)}><Trash2 size={14} />삭제</button> : null}
              </article>
            ))}
          </div>
          {thoughtStatus ? <p className="help-text">{thoughtStatus}</p> : null}
          {!thoughtStatus && thoughts.length > 0 && visibleThoughts.length === 0 ? <p className="help-text">일치하는 생각이 없습니다.</p> : null}
        </section>
      ) : (
        <section className="capture-card" aria-labelledby="capture-title">
          <header className="capture-header">
            <div><p className="eyebrow">Context OS</p><h1 id="capture-title">생각 남기기</h1></div>
            <div className="header-actions"><button className="summary-entry-button" type="button" onClick={openSummary}><Sparkles size={15} />오늘 요약</button><button className="icon-button" type="button" aria-label="생각 전체 조회" onClick={openThoughts}><Search size={17} /></button><button className="icon-button" type="button" aria-label="연결 설정" onClick={openSettings}><Settings size={17} /></button></div>
          </header>
          <div className="source-row">
            <Link2 size={17} aria-hidden="true" />
            <div><span>현재 링크</span><strong>{activeTab?.title || '현재 탭을 불러오는 중…'}</strong><code>{activeTab?.url || ''}</code></div>
          </div>
          {linkedThoughts.length > 0 ? <button className="related-thought" type="button" onClick={openLinkedThoughts}><span>여기서 기록했던 메모가 있어요</span><p>{linkedThoughts[0].data.content}</p><small>이 링크의 생각 전체 보기</small></button> : null}
          <label className="capture-field">
            <span>내 메모</span>
            <textarea
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void saveCapture() } }}
              placeholder="생각을 남기거나 짧게 메모하세요…"
            />
          </label>
          <button className="primary-button" type="button" disabled={!canCapture} onClick={() => void saveCapture()}>{canCapture ? <><Send size={17} />기록 남기기</> : '새 탭 또는 웹페이지에서 기록할 수 있어요'}</button>
          <p className="shortcut">⌘↵로 바로 저장 · 현재 링크는 자동으로 첨부됩니다.</p>
        </section>
      )}
      {status ? <p className="capture-status" role="status">{status}</p> : null}
    </main>
  )
}
