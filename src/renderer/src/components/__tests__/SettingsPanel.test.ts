// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, VueWrapper, DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import SettingsPanel from '../SettingsPanel.vue'
import type { AiDiagnoseResult, Settings } from '@shared/types'

const SETTINGS: Settings = {
  mcpEnabled: true,
  mcpPort: 8080,
  mcpToken: 'token',
  mcpDisabledTools: [],
  themeColor: '#10b981',
  backgroundColor: '#0d0d0d',
  navColor: '#141414',
  followSystemTheme: false,
  uiFont: '',
  windowOpacity: 100,
  uiScale: 100,
  autoLaunch: false,
  disableHardwareAcceleration: false,
  blockSystemSleep: false,
  closeButtonAction: 'hide',
  confirmOnClose: false,
  language: 'zh-CN',
  aiBaseUrl: 'http://127.0.0.1:8123/v1',
  aiModel: 'gpt-4o-mini',
  aiAutoExecute: false
}

const MISMATCH: AiDiagnoseResult = {
  ok: true,
  configuredModel: 'gpt-4o-mini',
  servedModel: 'qwen-max',
  reportedModel: 'Qwen-Max',
  catalogChecked: true,
  catalogMatch: false,
  catalogSimilar: ['gpt-4o'],
  catalogSize: 3,
  verdict: 'mismatch',
  confidence: 'high',
  score: -2,
  probes: [
    {
      id: 'identity-zh',
      ok: true,
      servedModel: 'qwen-max',
      reportedModel: 'Qwen-Max',
      answer: '我是阿里云的 Qwen-Max。',
      durationMs: 12
    }
  ],
  durationMs: 30
}

type ApiMock = Record<string, ReturnType<typeof vi.fn>>

function makeApi(): ApiMock {
  return {
    getSettings: vi.fn(async () => SETTINGS),
    updateSettings: vi.fn(async (patch: Partial<Settings>) => ({ ...SETTINGS, ...patch })),
    getAppInfo: vi.fn(async () => ({ version: '1.0.0', platform: 'darwin' })),
    regenerateToken: vi.fn(async () => 'token'),
    exportSettings: vi.fn(async () => null),
    importSettings: vi.fn(async () => ({ ok: true })),
    aiStatus: vi.fn(async () => ({
      configured: true,
      keySet: true,
      baseUrl: SETTINGS.aiBaseUrl,
      model: SETTINGS.aiModel
    })),
    setAiKey: vi.fn(async () => ({
      configured: true,
      keySet: true,
      baseUrl: SETTINGS.aiBaseUrl,
      model: SETTINGS.aiModel
    })),
    listAiModels: vi.fn(async () => ({
      ok: true,
      models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'qwen-max' }],
      durationMs: 5
    })),
    testAi: vi.fn(async () => ({ ok: true, durationMs: 18 })),
    diagnoseAi: vi.fn(async () => MISMATCH)
  }
}

async function mountPanel(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(SettingsPanel, {
    props: { visible: false },
    global: { plugins: [pinia, ElementPlus] },
    attachTo: document.body
  })
  // 面板常驻挂载、由 visible 控制显示，打开动作才会触发配置加载
  await wrapper.setProps({ visible: true })
  await flushPromises()
  const aiNav = wrapper.findAll('.nav-item').find((n) => n.text().includes('AI'))
  expect(aiNav).toBeTruthy()
  await aiNav?.trigger('click')
  await flushPromises()
  return wrapper
}

/** `<script setup>` 默认不暴露内部状态，测试通过 setupState 读取/改值 */
function setupState<T>(wrapper: VueWrapper): T {
  return (wrapper.vm.$ as unknown as { setupState: T }).setupState
}

function buttonByText(wrapper: VueWrapper, text: string): DOMWrapper<Element> | undefined {
  return wrapper.findAll('.test-actions button').find((b) => b.text().includes(text))
}

describe('设置 - AI：模型下拉框与模型诊断', () => {
  beforeEach(() => {
    const api = makeApi()
    ;(window as unknown as { api: ApiMock }).api = api
    // Element Plus 部分组件依赖以下浏览器 API，jsdom 里用最小实现垫上
    if (!('ResizeObserver' in globalThis)) {
      class ResizeObserverStub {
        private targets: Element[] = []
        observe(target: Element): void {
          this.targets.push(target)
        }
        unobserve(target: Element): void {
          this.targets = this.targets.filter((t) => t !== target)
        }
        disconnect(): void {
          this.targets = []
        }
      }
      ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
    }
  })

  it('进入 AI 分区后模型名是可模糊搜索的下拉框，并已加载目录', async () => {
    const wrapper = await mountPanel()
    const select = wrapper.findComponent({ name: 'ElSelect' })
    expect(select.exists()).toBe(true)
    expect(select.props('filterable')).toBe(true)
    expect(select.props('allowCreate')).toBe(true)
    expect((window as unknown as { api: ApiMock }).api.listAiModels).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('测试连接未通过时诊断按钮禁用且点击不发起请求', async () => {
    const api = (window as unknown as { api: ApiMock }).api
    const wrapper = await mountPanel()
    const diagnose = buttonByText(wrapper, '诊断')
    expect(diagnose).toBeTruthy()
    expect(diagnose?.attributes('disabled')).toBeDefined()

    await diagnose?.trigger('click')
    await flushPromises()
    expect(api.diagnoseAi).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('测试连接通过后按钮可用，诊断结果展示不一致结论', async () => {
    const api = (window as unknown as { api: ApiMock }).api
    const wrapper = await mountPanel()

    await buttonByText(wrapper, '测试')?.trigger('click')
    await flushPromises()

    const diagnose = buttonByText(wrapper, '诊断')
    expect(diagnose?.attributes('disabled')).toBeUndefined()

    await diagnose?.trigger('click')
    await flushPromises()

    expect(api.diagnoseAi).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.diagnose-grid').exists()).toBe(true)
    const text = wrapper.text()
    expect(text).toContain('不一致')
    expect(text).toContain('qwen-max')
    expect(text).toContain('Qwen-Max')
    wrapper.unmount()
  })

  it('改动模型名会让诊断按钮重新变回禁用', async () => {
    const wrapper = await mountPanel()

    await buttonByText(wrapper, '测试')?.trigger('click')
    await flushPromises()
    expect(buttonByText(wrapper, '诊断')?.attributes('disabled')).toBeUndefined()

    const vm = setupState<{ aiModel: string }>(wrapper)
    vm.aiModel = 'gpt-4o'
    await flushPromises()
    expect(buttonByText(wrapper, '诊断')?.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
