// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { useAiChatHistoryStore, deriveTitle, messagesToTimeline, timelineToMessages } from '../aiChatHistory'
import { useAiChatStore } from '../aiChat'
import type { ChatTimelineItem } from '../aiChat'

type ApiMock = Record<string, ReturnType<typeof vi.fn>>

const saved: { id: string; title: string; messages: unknown[] }[] = []
let stored: Record<string, { id: string; title: string; messages: unknown[]; createdAt: number; updatedAt: number }> = {}

function makeApi(): ApiMock {
  return {
    listAiChats: vi.fn(async () => Object.values(stored)),
    saveAiChat: vi.fn(async (conversation: { id: string; title: string; messages: unknown[] }) => {
      saved.push(conversation)
      stored[conversation.id] = conversation as never
    }),
    deleteAiChat: vi.fn(async (id: string) => {
      delete stored[id]
    }),
    clearAiChats: vi.fn(async () => {
      stored = {}
    })
  }
}

function timeline(): ChatTimelineItem[] {
  return [
    { id: 'u1', type: 'user', text: '检查 nginx 状态' },
    { id: 'a1', type: 'assistant', text: '服务运行中' },
    {
      id: 't1',
      type: 'tool',
      callId: 't1',
      command: 'systemctl status nginx',
      purpose: '查看服务状态',
      risk: 'low',
      status: 'success',
      result: { stdout: 'active', stderr: '', exitCode: 0, truncated: false, durationMs: 12 },
      expanded: true
    }
  ]
}

beforeEach(() => {
  saved.length = 0
  stored = {}
  setActivePinia(createPinia())
  ;(window as unknown as { api: ApiMock }).api = makeApi()
})

describe('aiChatHistory store', () => {
  it('保存对话时以首条提问作为标题', async () => {
    const store = useAiChatHistoryStore()
    await store.persist(timeline())
    expect(saved).toHaveLength(1)
    expect(saved[0].title).toBe('检查 nginx 状态')
    expect(store.currentId).toBeTruthy()
  })

  it('同一对话重复保存为覆盖更新，不新增条目', async () => {
    const store = useAiChatHistoryStore()
    await store.persist(timeline())
    const firstId = store.currentId
    await store.persist([...timeline(), { id: 'u2', type: 'user', text: '再看日志' }])
    expect(saved).toHaveLength(2)
    expect(saved[1].id).toBe(firstId)
    expect(store.conversations).toHaveLength(1)
  })

  it('startNew 之后另起新对话', async () => {
    const store = useAiChatHistoryStore()
    await store.persist(timeline())
    const firstId = store.currentId
    store.startNew()
    await store.persist(timeline())
    expect(store.currentId).not.toBe(firstId)
    expect(store.conversations).toHaveLength(2)
  })

  it('空时间线不落盘', async () => {
    const store = useAiChatHistoryStore()
    await store.persist([])
    expect(saved).toHaveLength(0)
  })

  it('删除与清空历史', async () => {
    const store = useAiChatHistoryStore()
    await store.persist(timeline())
    await store.persist(timeline())
    expect(store.conversations).toHaveLength(1)
    await store.remove(store.conversations[0].id)
    expect(store.conversations).toHaveLength(0)
    await store.persist(timeline())
    await store.clearAll()
    expect(store.conversations).toHaveLength(0)
  })

  it('aiChat store 在发送后自动落盘', async () => {
    const chat = useAiChatStore()
    ;(window as unknown as { api: ApiMock }).api = {
      ...makeApi(),
      aiStatus: vi.fn(async () => ({ configured: true })),
      aiChatStart: vi.fn(async () => undefined),
      onAiChatEvent: vi.fn(() => () => undefined)
    }
    await chat.send('看看磁盘占用', { sessionId: 's1', connectionId: 'c1' })
    expect(saved.length).toBeGreaterThan(0)
    expect(saved[0].messages.some((m) => (m as { text?: string }).text === '看看磁盘占用')).toBe(true)
  })

  it('回看历史可重建时间线', () => {
    const messages = timelineToMessages(timeline())
    const rebuilt = messagesToTimeline(messages)
    expect(rebuilt).toHaveLength(3)
    expect(rebuilt[0]).toMatchObject({ type: 'user', text: '检查 nginx 状态' })
    expect(rebuilt[2]).toMatchObject({ type: 'tool', command: 'systemctl status nginx' })
    // 回看时不需要审批交互
    expect(rebuilt[2].requiresApproval).toBeUndefined()
  })

  it('标题超长时截断', () => {
    const title = deriveTitle([{ id: 'u1', role: 'user', text: 'x'.repeat(50) }])
    expect(title.length).toBeLessThanOrEqual(25)
  })

  it('响应式时间线转出的消息可被 IPC 结构化克隆', () => {
    // Vue 响应式代理无法结构化克隆，必须转成普通对象
    const reactive = ref(timeline())
    const messages = timelineToMessages(reactive.value)
    expect(() => structuredClone(messages)).not.toThrow()
    expect(messages[2].result?.stdout).toBe('active')
  })
})
