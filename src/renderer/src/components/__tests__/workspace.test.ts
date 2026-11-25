// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import ElementPlus from 'element-plus'
import WorkspaceGrid from '../workspace/WorkspaceGrid.vue'
import TerminalPane from '../workspace/TerminalPane.vue'
import { useWorkspaceStore } from '../../stores/workspace'

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

async function mountPane(paneId: string): Promise<VueWrapper> {
  const wrapper = mount(TerminalPane, {
    props: { paneId },
    global: { plugins: [ElementPlus] }
  })
  await flushPromises()
  return wrapper
}

describe('工作区 UI：空窗格与连接选择器', () => {
  it('未绑定会话的窗格展示空态并能列出连接', async () => {
    const store = useWorkspaceStore()
    const tab = store.createTab('空标签')
    const wrapper = await mountPane(tab.focusedPaneId)

    expect(wrapper.text()).toContain('空窗格')
    expect(wrapper.text()).toContain('选择连接')

    await wrapper.find('.pane-empty .el-button').trigger('click')
    await flushPromises()
    // 连接中心未加载任何连接时，列表为空并给出提示
    expect(wrapper.find('.pane-picker').exists()).toBe(true)
    expect(wrapper.text()).toContain('没有匹配的连接')
    wrapper.unmount()
  })

  it('窗格标题栏提供拆分与关闭入口', async () => {
    const store = useWorkspaceStore()
    const tab = store.createTab('空标签')
    const wrapper = await mountPane(tab.focusedPaneId)

    const buttons = wrapper.findAll('.pane-btn')
    expect(buttons.length).toBeGreaterThanOrEqual(3)
    // 第三个按钮是关闭（拆分左右、拆分上下、关闭）
    await buttons[buttons.length - 1].trigger('click')
    await flushPromises()
    expect(store.tabs).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('工作区 UI：分屏树渲染', () => {
  it('拆分后渲染两个窗格，关闭其中一个后剩余窗格仍在', async () => {
    const store = useWorkspaceStore()
    const tab = store.createTab('标签一')
    const rootPaneId = tab.focusedPaneId
    expect(store.splitPane(rootPaneId, 'x')).toBe(true)
    const newPaneId = store.focusedPane!.id

    // 用响应式宿主渲染，模拟 App.vue 中 `:node="tab.root"` 的传参方式
    const Host = defineComponent({
      setup() {
        const s = useWorkspaceStore()
        return () => h(WorkspaceGrid, { tabId: s.tabs[0].id })
      }
    })
    const wrapper = mount(Host, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.findAll('.pane')).toHaveLength(2)
    expect(wrapper.find('.grid-divider').exists()).toBe(true)

    await store.closePane(newPaneId)
    await flushPromises()
    expect(wrapper.findAll('.pane')).toHaveLength(1)
    wrapper.unmount()
  })

  it('达到窗格上限后不再拆分', async () => {
    const store = useWorkspaceStore()
    const tab = store.createTab('标签一')
    const first = tab.focusedPaneId
    store.splitPane(first, 'x')
    store.splitPane(store.focusedPane!.id, 'y')
    store.splitPane(store.focusedPane!.id, 'x')
    expect(store.splitPane(store.focusedPane!.id, 'y')).toBe(false)
    expect(store.tabs[0].root).toBeDefined()
  })

  it('拆分时原窗格组件不重建，终端内容得以保留', async () => {
    const store = useWorkspaceStore()
    const tab = store.createTab('标签一')
    const wrapper = mount(WorkspaceGrid, {
      props: { tabId: tab.id },
      global: { plugins: [ElementPlus] }
    })
    await flushPromises()

    const firstPane = wrapper.find('.pane').element as HTMLElement
    firstPane.dataset.marker = 'keep'

    store.splitPane(tab.focusedPaneId, 'x')
    await flushPromises()

    const panes = wrapper.findAll('.pane')
    expect(panes).toHaveLength(2)
    const kept = panes.find((p) => (p.element as HTMLElement).dataset.marker === 'keep')
    expect(kept).toBeTruthy()
    // 同一个 DOM 节点：说明原窗格没有被卸载重建
    expect(kept?.element).toBe(firstPane)
    wrapper.unmount()
  })
})
