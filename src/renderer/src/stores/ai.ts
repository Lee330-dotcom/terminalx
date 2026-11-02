import { defineStore } from 'pinia'
import { AiAnalysisKind } from '@shared/types'
import { CommandSuggestion, parseCommandBlocks } from '../utils/aiCommand'

let listenersBound = false

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** IPC invoke 的报错会带 "Error invoking remote method ..." 前缀，去掉便于阅读 */
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export interface AiRunContext {
  kind: AiAnalysisKind
  title: string
  scope?: string
  sessionId?: string
  selection?: string
  connectionId?: string
  errorMessage?: string
  instruction?: string
}

export const useAiStore = defineStore('ai', {
  state: () => ({
    visible: false,
    running: false,
    requestId: null as string | null,
    title: '',
    scope: '',
    text: '',
    error: '',
    cancelled: false,
    configured: null as boolean | null,
    kind: null as AiAnalysisKind | null,
    runSessionId: null as string | null,
    commands: [] as CommandSuggestion[],
    panelTab: 'analysis' as 'analysis' | 'assistant'
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
      window.api.onAiChunk((ev) => {
        if (ev.requestId !== this.requestId) return
        this.text += ev.delta
      })
      window.api.onAiDone((ev) => {
        if (ev.requestId !== this.requestId) return
        this.running = false
        if (ev.error) this.error = ev.error
        if (ev.cancelled) this.cancelled = true
        if (this.kind === 'command-suggestion' && !ev.error && !ev.cancelled) {
          this.commands = parseCommandBlocks(this.text)
        }
      })
    },
    async run(ctx: AiRunContext): Promise<void> {
      this.ensureListeners()
      await this.refreshStatus()
      this.visible = true
      this.panelTab = 'analysis'
      this.title = ctx.title
      this.scope = ctx.scope ?? ''
      this.text = ''
      this.error = ''
      this.cancelled = false
      this.kind = ctx.kind
      this.runSessionId = ctx.sessionId ?? null
      this.commands = []
      if (this.configured === false) {
        this.running = false
        this.error = '尚未配置 AI 服务，请先在 设置 → AI 中填写服务地址、模型并保存 API Key'
        return
      }
      const requestId = newRequestId()
      this.requestId = requestId
      this.running = true
      try {
        await window.api.aiAnalyze({
          requestId,
          kind: ctx.kind,
          sessionId: ctx.sessionId,
          selection: ctx.selection,
          connectionId: ctx.connectionId,
          errorMessage: ctx.errorMessage,
          instruction: ctx.instruction
        })
      } catch (err) {
        if (this.requestId !== requestId) return
        this.running = false
        this.error = readableError(err)
      }
    },
    cancel(): void {
      if (!this.running || !this.requestId) return
      window.api.cancelAi(this.requestId)
    },
    hide(): void {
      this.visible = false
    }
  }
})
