const TOGGLE_PANEL_COMMAND = 'toggle-side-panel'
const OPEN_PANEL_TAB_IDS_KEY = 'openSidePanelTabIds'

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  }
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== TOGGLE_PANEL_COMMAND || !chrome.sidePanel) return

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (activeTab?.id == null) return

  const tabId = activeTab.id
  const stored = await chrome.storage.session.get(OPEN_PANEL_TAB_IDS_KEY)
  const openTabIds = Array.isArray(stored[OPEN_PANEL_TAB_IDS_KEY])
    ? stored[OPEN_PANEL_TAB_IDS_KEY]
    : []
  const panelIsOpen = openTabIds.includes(tabId)

  if (panelIsOpen) {
    await chrome.sidePanel.setOptions({ tabId, enabled: false })
    await chrome.storage.session.set({
      [OPEN_PANEL_TAB_IDS_KEY]: openTabIds.filter((id) => id !== tabId)
    })
    return
  }

  await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true })
  await chrome.sidePanel.open({ tabId })
  await chrome.storage.session.set({
    [OPEN_PANEL_TAB_IDS_KEY]: [...new Set([...openTabIds, tabId])]
  })
})
