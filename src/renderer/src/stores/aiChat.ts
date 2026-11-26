import { defineStore } from 'pinia'
import { AiChatEvent, AiChatStartRequest, AiChatToolResult, CommandRiskLevel } from '@shared/types'
import { messagesToTimeline, useAiChatHistoryStore } from './aiChatHistory'

let listenersBound = false

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export type ToolStatus =
  'awaiting-approval' | 'running' | 'success' | 'failed' | 'rejected' | 'skipped'

export interface ChatTimelineItem {
  id: string
  type: 'user' | 'assistant' | 'notice' | 'tool'
  text?: string
  callId?: string
  command?: string
  purpose?: string
  risk?: CommandRiskLevel
  requiresApproval?: boolean
  reason?: string
  status?: ToolStatus
  result?: AiChatToolResult
  error?: string
  expanded?: boolean
}

export interface ChatSessionRef {
  sessionId: string
  connectionId: string
}

export const useAiChatStore = defineStore('aiChat', {
  state: () => ({
    sessionId: null as string | null,
    requestId: null as string | null,
    running: false,
    stopping: false,
    configured: null as boolean | null,
    error: '',
    timeline: [] as ChatTimelineItem[],
    stepLimitReached: false
  }),
  actions: {
    async refreshStatus(): Promise<void> {
      try {
        const status = await window.api.aiStatus()
        this.configured = status.configured
      } catch {
        this.configured = false
      }
    },
    ensureListeners(): void {
      if (listenersBound) return
      listenersBound = true
      window.api.onAiChatEvent((ev) => this.handleEvent(ev))
    },
    handleEvent(ev: AiChatEvent): void {
      if (ev.requestId !== this.requestId) return
      switch (ev.type) {
        case 'delta':
          this.appendDelta(ev.delta)
          break
        case 'tool-call':
          this.timeline.push({
            id: ev.callId,
            type: 'tool',
            callId: ev.callId,
            command: ev.command,
            purpose: ev.purpose,
            risk: ev.risk,
            requiresApproval: ev.requiresApproval,
            reason: ev.reason,
            status: ev.requiresApproval ? 'awaiting-approval' : 'running'
          })
          break
        case 'tool-result': {
          const item = this.toolItem(ev.callId)
          if (!item) break
          if (ev.rejected) {
            item.status = 'rejected'
            item.error = '已跳过执行'
          } else if (ev.ok) {
            item.status = 'success'
            item.result = ev.result
            item.error = undefined
          } else {
            item.status = 'failed'
            item.error = ev.error ?? '执行失败'
          }
          break
        }
        case 'step-limit':
          this.stepLimitReached = true
          this.timeline.push({
            id: `limit-${Date.now()}`,
            type: 'notice',
            text: `已达到 ${ev.limit} 次命令上限，正在基于已有结果生成总结…`
          })
          break
        case 'done':
          this.running = false
          this.stopping = false
          if (ev.error) this.error = ev.error
          if (ev.cancelled) {
            this.timeline.push({
              id: `done-${Date.now()}`,
              type: 'notice',
              text: '已停止'
            })
          }
          if (ev.error || ev.cancelled) {
            for (const item of this.timeline) {
              if (item.type !== 'tool') continue
              if (item.status === 'awaiting-approval') {
                item.status = 'skipped'
                item.error = '已中断'
              } else if (item.status === 'running') {
                item.status = 'failed'
                item.error = '已中断'
              }
            }
          }
          // 本轮结束，把助手回复与工具结果补进历史
          void this.persistHistory()
          break
      }
    },
    appendDelta(delta: string): void {
      const last = this.timeline[this.timeline.length - 1]
      if (last?.type === 'assistant') {
        last.text = (last.text ?? '') + delta
      } else {
        this.timeline.push({
          id: `assistant-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          type: 'assistant',
          text: delta
        })
      }
    },
    toolItem(callId: string): ChatTimelineItem | null {
      return this.timeline.find((item) => item.type === 'tool' && item.callId === callId) ?? null
    },
    async send(text: string, session: ChatSessionRef): Promise<void> {
      const trimmed = text.trim()
      if (!trimmed) return
      this.ensureListeners()
      this.stopCurrent()
      await this.refreshStatus()
      this.sessionId = session.sessionId
      this.error = ''
      this.stepLimitReached = false
      this.timeline.push({
        id: `user-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        type: 'user',
        text: trimmed
      })
      // 提问先落盘：助手还没回完就关应用也不丢记录
      void this.persistHistory()
      if (this.configured === false) {
        this.error = '尚未配置 AI 服务，请先在 设置 → AI 中填写服务地址、模型并保存 API Key'
        return
      }
      const requestId = newRequestId()
      this.requestId = requestId
      this.running = true
      this.stopping = false
      const request: AiChatStartRequest = {
        requestId,
        sessionId: session.sessionId,
        connectionId: session.connectionId,
        text: trimmed
      }
      try {
        await window.api.aiChatStart(request)
      } catch (err) {
        if (this.requestId !== requestId) return
        this.running = false
        this.stopping = false
        this.error = readableError(err)
      }
    },
    approve(callId: string, approved: boolean): void {
      const item = this.toolItem(callId)
      if (!item || item.status !== 'awaiting-approval' || !this.requestId) return
      item.status = approved ? 'running' : 'skipped'
      if (!approved) item.error = '已跳过执行'
      window.api.aiChatApprove(this.requestId, callId, approved)
    },
    stop(): void {
      if (!this.running || !this.requestId) return
      this.stopping = true
      window.api.aiChatCancel(this.requestId)
    },
    markInterrupted(): void {
      for (const item of this.timeline) {
        if (item.type !== 'tool') continue
        if (item.status === 'awaiting-approval') {
          item.status = 'skipped'
          item.error = '已中断'
        } else if (item.status === 'running') {
          item.status = 'failed'
          item.error = '已中断'
        }
      }
    },
    stopCurrent(): void {
      if (this.running && this.requestId) window.api.aiChatCancel(this.requestId)
      if (this.running) this.markInterrupted()
      this.running = false
      this.stopping = false
      this.requestId = null
    },
    clear(): void {
      this.running = false
      this.stopping = false
      this.requestId = null
      this.error = ''
      this.timeline = []
      this.stepLimitReached = false
      // 清空即另起新对话：下一条消息不写进上一段历史
      useAiChatHistoryStore().startNew()
    },
    /** 把当前对话写入本地历史（幂等：同一对话为覆盖更新）。 */
    async persistHistory(): Promise<void> {
      if (this.timeline.length === 0) return
      const history = useAiChatHistoryStore()
      await history.persist(this.timeline)
    },
    /** 回看一段历史对话：重建时间线（只读，不恢复运行中的请求）。 */
    loadHistory(messages: Parameters<typeof messagesToTimeline>[0]): void {
      this.stopCurrent()
      this.timeline = messagesToTimeline(messages)
      this.error = ''
      this.stepLimitReached = false
    },
    handleActiveSessionChange(prev: string | null, next: string | null): void {
      if (prev === next) return
      if (prev) {
        this.stopCurrent()
        window.api.aiChatReset(prev)
        this.clear()
      }
      this.sessionId = next
    },
    handleDisconnect(sessionId: string): void {
      if (this.sessionId !== sessionId) return
      this.stopCurrent()
      window.api.aiChatReset(sessionId)
      this.clear()
    },
    reset(): void {
      this.stopCurrent()
      if (this.sessionId) window.api.aiChatReset(this.sessionId)
      this.clear()
    }
  }
})
