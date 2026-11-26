import { defineStore } from 'pinia'
import { ref } from 'vue'
import { AiChatConversation, AiChatMessage, AiChatToolResult } from '@shared/types'
import type { ChatTimelineItem } from './aiChat'

/** 标题截断长度：首条提问摘要最多 24 个字符。 */
const TITLE_MAX = 24

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * 把工具执行结果拷成普通对象。
 *
 * 时间线里的对象来自 Pinia/Vue，是响应式代理；代理对象无法被结构化克隆，
 * 直接丢给 IPC 会抛 "An object could not be cloned"。
 */
function toPlainResult(result: AiChatToolResult): AiChatToolResult {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    truncated: result.truncated,
    durationMs: result.durationMs
  }
}

/** 时间线项 → 可持久化的消息（只保留语义字段，丢掉纯 UI 状态）。 */
export function timelineToMessages(timeline: ChatTimelineItem[]): AiChatMessage[] {
  return timeline.map((item) => {
    const message: AiChatMessage = { id: item.id, role: item.type }
    if (item.text !== undefined) message.text = item.text
    if (item.command !== undefined) message.command = item.command
    if (item.purpose !== undefined) message.purpose = item.purpose
    if (item.risk !== undefined) message.risk = item.risk
    if (item.status !== undefined) message.status = item.status
    if (item.error !== undefined) message.error = item.error
    if (item.result !== undefined) message.result = toPlainResult(item.result)
    return message
  })
}

/** 历史消息 → 时间线项（回看用，工具项不再提供审批交互）。 */
export function messagesToTimeline(messages: AiChatMessage[]): ChatTimelineItem[] {
  return messages.map((m) => {
    const item: ChatTimelineItem = { id: m.id, type: m.role }
    if (m.text !== undefined) item.text = m.text
    if (m.command !== undefined) {
      item.command = m.command
      item.callId = m.id
    }
    if (m.purpose !== undefined) item.purpose = m.purpose
    if (m.risk !== undefined) item.risk = m.risk
    if (m.status !== undefined) item.status = m.status as ChatTimelineItem['status']
    if (m.error !== undefined) item.error = m.error
    if (m.result !== undefined) item.result = m.result
    return item
  })
}

/** 取首条用户提问作为对话标题。 */
export function deriveTitle(messages: AiChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && m.text)
  const text = (first?.text ?? '').trim()
  if (!text) return 'AI 对话'
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text
}

/**
 * 助手对话历史：本地持久化每一轮对话，支持列表、回看与清理。
 *
 * 保存时机由 aiChat store 触发（提问发出后、助手本轮结束后）。
 */
export const useAiChatHistoryStore = defineStore('aiChatHistory', () => {
  const conversations = ref<AiChatConversation[]>([])
  const currentId = ref<string | null>(null)
  const loaded = ref(false)

  async function load(): Promise<void> {
    try {
      conversations.value = await window.api.listAiChats()
    } catch {
      conversations.value = []
    }
    loaded.value = true
  }

  function current(): AiChatConversation | null {
    return conversations.value.find((c) => c.id === currentId.value) ?? null
  }

  /** 另起新对话：下一条消息会写入新的历史条目。 */
  function startNew(): void {
    currentId.value = null
  }

  /** 保存当前时间线到历史（同一对话重复保存为覆盖更新）。 */
  async function persist(
    timeline: ChatTimelineItem[],
    meta?: { connectionName?: string }
  ): Promise<void> {
    const messages = timelineToMessages(timeline)
    if (messages.length === 0) return
    const now = Date.now()
    let id = currentId.value
    if (!id) {
      id = newId()
      currentId.value = id
    }
    const existing = conversations.value.find((c) => c.id === id)
    const conversation: AiChatConversation = {
      id,
      title: existing?.title ?? deriveTitle(messages),
      connectionName: meta?.connectionName ?? existing?.connectionName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages
    }
    await window.api.saveAiChat(conversation)
    const index = conversations.value.findIndex((c) => c.id === id)
    if (index >= 0) conversations.value.splice(index, 1, conversation)
    else conversations.value.unshift(conversation)
  }

  async function remove(id: string): Promise<void> {
    await window.api.deleteAiChat(id)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (currentId.value === id) currentId.value = null
  }

  async function clearAll(): Promise<void> {
    await window.api.clearAiChats()
    conversations.value = []
    currentId.value = null
  }

  return { conversations, currentId, loaded, load, current, startNew, persist, remove, clearAll }
})
