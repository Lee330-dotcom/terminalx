// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from '../workspace'
import { collectPaneIds, countPanes } from '../../workspace/splitTree'

type ApiMock = Record<string, ReturnType<typeof vi.fn>>

let sessionSeq = 0

function makeApi(): ApiMock {
  return {
    openSession: vi.fn(async (connectionId: string) => {
      sessionSeq += 1
      return { sessionId: `sess-${connectionId}-${sessionSeq}` }
    }),
    closeSession: vi.fn(async () => undefined),
    reconnectSession: vi.fn(async () => undefined),
    onSessionStatus: vi.fn(() => () => undefined)
  }
}

beforeEach(() => {
  sessionSeq = 0
  setActivePinia(createPinia())
  ;(window as unknown as { api: ApiMock }).api = makeApi()
})

describe('workspace store：标签', () => {
  it('打开连接会创建标签与窗格，并聚焦新标签', async () => {
    const store = useWorkspaceStore()
    await store.openConnection('c1', '主机一')
    expect(store.tabs).toHaveLength(1)
    expect(store.activeTabId).toBe(store.tabs[0].id)
    expect(store.focusedPane?.connectionId).toBe('c1')
    expect(store.focusedPane?.status).toBe('connecting')
  })

  it('同一连接重复打开时复用已有标签，不新建会话', async () => {
    const store = useWorkspaceStore()
    const api = (window as unknown as { api: ApiMock }).api
    await store.openConnection('c1', '主机一')
    await store.openConnection('c2', '主机二')
    expect(store.tabs).toHaveLength(2)
    await store.openConnection('c1', '主机一')
    expect(store.tabs).toHaveLength(2)
    expect(api.openSession).toHaveBeenCalledTimes(2)
    expect(store.focusedPane?.connectionId).toBe('c1')
  })

  it('关闭标签会关闭其下所有会话并移除窗格', async () => {
    const store = useWorkspaceStore()
    const api = (window as unknown as { api: ApiMock }).api
    await store.openConnection('c1', '主机一')
    const tabId = store.tabs[0].id
    await store.closeTab(tabId)
    expect(store.tabs).toHaveLength(0)
    expect(store.activeTabId).toBeNull()
    expect(Object.keys(store.panes)).toHaveLength(0)
    expect(api.closeSession).toHaveBeenCalledTimes(1)
  })
})

describe('workspace store：分屏', () => {
  it('拆分窗格产生空窗格并聚焦它', async () => {
    const store = useWorkspaceStore()
    await store.openConnection('c1', '主机一')
    const paneId = store.focusedPane!.id
    expect(store.splitPane(paneId, 'x')).toBe(true)
    expect(countPanes(store.tabs[0].root)).toBe(2)
    expect(store.focusedPane?.sessionId).toBeNull()
    expect(store.focusedPane?.id).not.toBe(paneId)
  })

  it('窗格上限为 4，超出后拒绝拆分', async () => {
    const store = useWorkspaceStore()
    await store.openConnection('c1', '主机一')
    let paneId = store.focusedPane!.id
    for (let i = 0; i < 3; i++) {
      expect(store.splitPane(paneId, 'x')).toBe(true)
      paneId = store.focusedPane!.id
    }
    expect(countPanes(store.tabs[0].root)).toBe(4)
    expect(store.splitPane(paneId, 'x')).toBe(false)
    expect(countPanes(store.tabs[0].root)).toBe(4)
  })

  it('关闭窗格会关闭其会话并折叠布局', async () => {
    const store = useWorkspaceStore()
    const api = (window as unknown as { api: ApiMock }).api
    await store.openConnection('c1', '主机一')
    const first = store.focusedPane!.id
    store.splitPane(first, 'x')
    const second = store.focusedPane!.id
    await store.openSessionInPane(second, 'c2', '主机二')
    expect(api.openSession).toHaveBeenCalledTimes(2)

    await store.closePane(second)
    expect(countPanes(store.tabs[0].root)).toBe(1)
    expect(collectPaneIds(store.tabs[0].root)).toEqual([first])
    expect(api.closeSession).toHaveBeenCalledTimes(1)
  })

  it('关闭标签内最后一个窗格会连带关闭标签', async () => {
    const store = useWorkspaceStore()
    await store.openConnection('c1', '主机一')
    const paneId = store.focusedPane!.id
    await store.closePane(paneId)
    expect(store.tabs).toHaveLength(0)
    expect(store.activeTabId).toBeNull()
  })

  it('同一连接可在不同窗格各开一条独立会话', async () => {
    const store = useWorkspaceStore()
    const api = (window as unknown as { api: ApiMock }).api
    await store.openConnection('c1', '主机一')
    const first = store.focusedPane!.id
    store.splitPane(first, 'x')
    const second = store.focusedPane!.id
    await store.openSessionInPane(second, 'c1', '主机一')
    expect(api.openSession).toHaveBeenCalledTimes(2)
    const ids = collectPaneIds(store.tabs[0].root)
    const sessions = ids.map((id) => store.panes[id].sessionId)
    expect(sessions[0]).not.toBe(sessions[1])
    expect(sessions.every((s) => s !== null)).toBe(true)
  })
})

describe('workspace store：焦点与状态', () => {
  it('切换焦点窗格会更新焦点与联动锚点', async () => {
    const store = useWorkspaceStore()
    await store.openConnection('c1', '主机一')
    const first = store.focusedPane!.id
    store.splitPane(first, 'x')
    const second = store.focusedPane!.id
    await store.openSessionInPane(second, 'c2', '主机二')
    store.focusPane(first)
    expect(store.focusedPane?.id).toBe(first)
    expect(store.activeSessionId).toBe(store.panes[first].sessionId)
    expect(store.activeConnectionId).toBe('c1')
  })

  it('循环焦点在标签内的窗格之间移动', async () => {
    const store = useWorkspaceStore()
    await store.openConnection('c1', '主机一')
    const first = store.focusedPane!.id
    store.splitPane(first, 'x')
    const second = store.focusedPane!.id
    store.cycleFocus(1)
    expect(store.focusedPane?.id).toBe(first)
    store.cycleFocus(-1)
    expect(store.focusedPane?.id).toBe(second)
  })

  it('会话状态事件会更新对应窗格', async () => {
    const store = useWorkspaceStore()
    let handler: ((ev: { sessionId: string; status: string; errorMessage?: string }) => void) | null =
      null
    const api = (window as unknown as { api: ApiMock }).api
    api.onSessionStatus.mockImplementation((cb) => {
      handler = cb
      return () => undefined
    })
    // 事件在回调里赋值，直接在用例中调用会被 TS 收窄成 never，故用函数包一层
    const emit = (ev: { sessionId: string; status: string; errorMessage?: string }): void => {
      handler?.(ev)
    }
    await store.openConnection('c1', '主机一')
    const pane = store.focusedPane!
    emit({ sessionId: pane.sessionId!, status: 'connected' })
    expect(store.focusedPane?.status).toBe('connected')
    emit({ sessionId: pane.sessionId!, status: 'error', errorMessage: 'boom' })
    expect(store.focusedPane?.status).toBe('error')
    expect(store.focusedPane?.errorMessage).toBe('boom')
  })

  it('重连窗格会回到 connecting 状态', async () => {
    const store = useWorkspaceStore()
    const api = (window as unknown as { api: ApiMock }).api
    await store.openConnection('c1', '主机一')
    const pane = store.focusedPane!
    pane.status = 'disconnected'
    await store.reconnectPane(pane.id)
    expect(api.reconnectSession).toHaveBeenCalledWith(pane.sessionId)
    expect(store.panes[pane.id].status).toBe('connecting')
  })

  it('更新分屏比例会写回布局树', async () => {
    const store = useWorkspaceStore()
    await store.openConnection('c1', '主机一')
    const paneId = store.focusedPane!.id
    store.splitPane(paneId, 'x')
    const root = store.tabs[0].root
    const splitId = root.type === 'split' ? root.id : ''
    store.setSplitRatio(splitId, 0.8)
    const next = store.tabs[0].root
    expect(next.type === 'split' && next.ratio).toBe(0.8)
  })
})
