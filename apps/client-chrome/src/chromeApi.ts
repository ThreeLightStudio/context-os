import { sampleTabs } from './seed'
import type { SavedTab } from './types'
import { createId, getDomain, inferSurface } from './utils'

function hasChromeTabs() {
  return typeof chrome !== 'undefined' && Boolean(chrome.tabs)
}

function toSavedTab(tab: chrome.tabs.Tab, index: number): SavedTab {
  const url = tab.url || 'chrome://newtab/'
  return {
    id: createId(`tab-${index}`),
    title: tab.title || getDomain(url),
    url,
    domain: getDomain(url),
    surface: inferSurface(url),
    favIconUrl: tab.favIconUrl
  }
}

export async function getCurrentWindowTabs(): Promise<SavedTab[]> {
  if (!hasChromeTabs()) return sampleTabs

  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ currentWindow: true }, resolve)
  })

  const usableTabs = tabs.filter((tab) => Boolean(tab.url) && !tab.url?.startsWith('chrome://'))
  return usableTabs.length > 0 ? usableTabs.map(toSavedTab) : sampleTabs
}

export async function getActiveTab(): Promise<SavedTab> {
  if (!hasChromeTabs()) return sampleTabs[0]

  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, resolve)
  })

  return tabs[0] ? toSavedTab(tabs[0], 0) : sampleTabs[0]
}

export function subscribeToActiveTab(onChange: (tab: SavedTab) => void): () => void {
  if (!hasChromeTabs()) return () => {}

  const refresh = () => { void getActiveTab().then(onChange) }
  const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    if (changeInfo.url !== undefined || changeInfo.title !== undefined || changeInfo.status === 'complete') refresh()
  }
  const onFocusChanged = () => refresh()

  chrome.tabs.onActivated.addListener(refresh)
  chrome.tabs.onUpdated.addListener(onUpdated)
  chrome.windows?.onFocusChanged.addListener(onFocusChanged)
  return () => {
    chrome.tabs.onActivated.removeListener(refresh)
    chrome.tabs.onUpdated.removeListener(onUpdated)
    chrome.windows?.onFocusChanged.removeListener(onFocusChanged)
  }
}

export async function reopenTabs(tabs: SavedTab[]): Promise<void> {
  if (!hasChromeTabs()) {
    console.info('Context Shelf would reopen tabs:', tabs.map((tab) => tab.url))
    return
  }

  for (const tab of tabs) {
    await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
      chrome.tabs.create({ url: tab.url, active: false }, resolve)
    })
  }
}
