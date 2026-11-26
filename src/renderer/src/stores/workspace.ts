import { defineStore } from 'pinia'
import { SessionStatus } from '@shared/types'
import {
  LayoutNode,
  MAX_PANES_PER_TAB,
  SplitAxis,
  collectPaneIds,
  countPanes,
  createPaneNode,
  removePane,
  splitPane as splitLayout,
  updateRatio
} from '../workspace/splitTree'
import { useSessionStore } from './sessions'

export interface PaneState {
  id: string
  tabId: string
  /** 未选择连接时为空态 */
  sessionId: string | null
  connectionId: string | null
  title: string
  status: SessionStatus
  errorMessage?: string
}

export interface WorkspaceTab {
  id: string
  title: string
  /** 标签内的分屏布局树 */
  root: LayoutNode
  /** 该标签的焦点窗格 */
  focusedPaneId: string
}

let seq = 0

function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`
}

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    tabs: [] as WorkspaceTab[],
    activeTabId: null as string | null,
    panes: {} as Record<string, PaneState>,
    /** 主进程会话状态订阅的取消函数：随 store 实例存在，避免跨实例串扰 */
    unsubStatus: null as (() => void) | null
  }),
  getters: {
    activeTab(state): WorkspaceTab | null {
      return state.tabs.find((t) => t.id === state.activeTabId) ?? null
    },
    /** 当前标签的焦点窗格：SFTP / 终端搜索 / AI 上下文都以它为锚点 */
    focusedPane(state): PaneState | null {
      const tab = state.tabs.find((t) => t.id === state.activeTabId)
      if (!tab) return null
      return state.panes[tab.focusedPaneId] ?? null
    },
    activeSessionId(): string | null {
      return this.focusedPane?.sessionId ?? null
    },
    activeConnectionId(): string | null {
      return this.focusedPane?.connectionId ?? null
    },
    hasTabs(state): boolean {
      return state.tabs.length > 0
    }
  },
  actions: {
    ensureStatusListener(): void {
      if (this.unsubStatus) return
      this.unsubStatus = window.api.onSessionStatus((ev) => {
        const pane = this.paneBySessionId(ev.sessionId)
        if (!pane) return
        pane.status = ev.status
        pane.errorMessage = ev.errorMessage
      })
    },

    paneBySessionId(sessionId: string): PaneState | null {
      return Object.values(this.panes).find((p) => p.sessionId === sessionId) ?? null
    },

    /** 标签内窗格按布局顺序排列 */
    tabPanes(tabId: string): PaneState[] {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab) return []
      return collectPaneIds(tab.root)
        .map((id) => this.panes[id])
        .filter((p): p is PaneState => p != null)
    },

    createTab(title: string): WorkspaceTab {
      const tabId = nextId('tab')
      const paneId = nextId('pane')
      const tab: WorkspaceTab = {
        id: tabId,
        title,
        root: createPaneNode(paneId),
        focusedPaneId: paneId
      }
      this.panes[paneId] = {
        id: paneId,
        tabId,
        sessionId: null,
        connectionId: null,
        title,
        status: 'connecting',
        errorMessage: undefined
      }
      this.tabs.push(tab)
      this.activeTabId = tabId
      this.ensureStatusListener()
      return tab
    },

    /**
     * 从连接中心打开连接：若该连接已在某个标签中打开，则聚焦那个标签与窗格，
     * 不重复创建会话。
     */
    async openConnection(connectionId: string, title?: string): Promise<void> {
      this.ensureStatusListener()
      const existing = Object.values(this.panes).find((p) => p.connectionId === connectionId)
      if (existing) {
        this.setActiveTab(existing.tabId)
        this.focusPane(existing.id)
        useSessionStore().recordUsage(connectionId)
        return
      }
      const tab = this.createTab(title ?? connectionId)
      await this.openSessionInPane(tab.focusedPaneId, connectionId, title)
    },

    /** 在指定窗格开启会话；同一连接允许在多个窗格各开一条独立会话 */
    async openSessionInPane(
      paneId: string,
      connectionId: string,
      title?: string
    ): Promise<void> {
      const pane = this.panes[paneId]
      if (!pane) return
      // 窗格已有会话时先关闭旧的，避免同一窗格挂两条会话
      if (pane.sessionId) {
        await this.closePaneSession(pane)
      }
      pane.connectionId = connectionId
      pane.title = title ?? connectionId
      pane.status = 'connecting'
      pane.errorMessage = undefined
      const started = performance.now()
      const { sessionId } = await window.api.openSession(connectionId)
      console.log(`[timing] 渲染层 ${connectionId} 打开会话 IPC ${Math.round(performance.now() - started)}ms`)
      pane.sessionId = sessionId
      // 首个字节到达时间：用户从点击连接到看到服务器输出的完整耗时
      const unsub = window.api.onSessionData((ev) => {
        if (ev.sessionId !== sessionId) return
        console.log(
          `[timing] 渲染层 ${connectionId} 首个字节 ${Math.round(performance.now() - started)}ms`
        )
        unsub()
      })
      useSessionStore().recordUsage(connectionId)
    },

    async closePaneSession(pane: PaneState): Promise<void> {
      if (!pane.sessionId) return
      const sessionId = pane.sessionId
      pane.sessionId = null
      try {
        await window.api.closeSession(sessionId)
      } catch {
        /* 主进程已不存在该会话时忽略 */
      }
    },

    setActiveTab(tabId: string): void {
      if (!this.tabs.some((t) => t.id === tabId)) return
      this.activeTabId = tabId
    },

    focusPane(paneId: string): void {
      const pane = this.panes[paneId]
      if (!pane) return
      this.setActiveTab(pane.tabId)
      const tab = this.tabs.find((t) => t.id === pane.tabId)
      if (tab) tab.focusedPaneId = paneId
    },

    /** 在当前标签内循环切换焦点窗格 */
    cycleFocus(delta: number): void {
      const tab = this.activeTab
      if (!tab) return
      const ids = collectPaneIds(tab.root)
      if (ids.length < 2) return
      const index = ids.indexOf(tab.focusedPaneId)
      const next = ids[(index + delta + ids.length) % ids.length]
      tab.focusedPaneId = next
    },

    /** 拆分窗格：返回 false 表示已达窗格上限 */
    splitPane(paneId: string, axis: SplitAxis): boolean {
      const tab = this.tabs.find((t) => t.id === this.panes[paneId]?.tabId)
      const pane = this.panes[paneId]
      if (!tab || !pane) return false
      if (countPanes(tab.root) >= MAX_PANES_PER_TAB) return false
      const newPaneId = nextId('pane')
      const splitId = nextId('split')
      const root = splitLayout(tab.root, paneId, axis, newPaneId, splitId)
      if (root === tab.root) return false
      tab.root = root
      this.panes[newPaneId] = {
        id: newPaneId,
        tabId: tab.id,
        sessionId: null,
        connectionId: null,
        title: '',
        status: 'connecting',
        errorMessage: undefined
      }
      tab.focusedPaneId = newPaneId
      return true
    },

    /** 关闭窗格；标签内只剩一个窗格时关闭整个标签 */
    async closePane(paneId: string): Promise<void> {
      const pane = this.panes[paneId]
      if (!pane) return
      const tab = this.tabs.find((t) => t.id === pane.tabId)
      await this.closePaneSession(pane)
      delete this.panes[paneId]
      if (!tab) return
      const { root } = removePane(tab.root, paneId)
      if (!root) {
        await this.closeTab(tab.id)
        return
      }
      tab.root = root
      if (tab.focusedPaneId === paneId) {
        const remaining = collectPaneIds(root)
        tab.focusedPaneId = remaining[0] ?? ''
      }
    },

    async closeTab(tabId: string): Promise<void> {
      const index = this.tabs.findIndex((t) => t.id === tabId)
      if (index < 0) return
      const panes = this.tabPanes(tabId)
      for (const pane of panes) {
        await this.closePaneSession(pane)
        delete this.panes[pane.id]
      }
      this.tabs.splice(index, 1)
      if (this.activeTabId === tabId) {
        this.activeTabId =
          this.tabs.length > 0 ? this.tabs[Math.max(0, index - 1)].id : null
      }
    },

    async reconnectPane(paneId: string): Promise<void> {
      const pane = this.panes[paneId]
      if (!pane?.sessionId) return
      pane.status = 'connecting'
      pane.errorMessage = undefined
      try {
        await window.api.reconnectSession(pane.sessionId)
      } catch (err) {
        pane.status = 'error'
        pane.errorMessage = String(err)
      }
    },

    /** 更新分屏比例 */
    setSplitRatio(splitId: string, ratio: number): void {
      const target = this.tabs.find((t) => hasSplit(t.root, splitId))
      if (!target) return
      target.root = updateRatio(target.root, splitId, ratio)
    }
  }
})

/** 布局树中是否存在指定分屏节点 */
function hasSplit(node: LayoutNode, splitId: string): boolean {
  if (node.type === 'pane') return false
  if (node.id === splitId) return true
  return hasSplit(node.children[0], splitId) || hasSplit(node.children[1], splitId)
}
