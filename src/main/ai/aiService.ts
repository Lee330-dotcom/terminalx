import {
  AiAnalysisRequest,
  AiChunkEvent,
  AiDoneEvent,
  AiStatus,
  AiTestResult,
  ConnectionMeta
} from '@shared/types'
import { ConnectionStore } from '../store/connectionStore'
import { CredentialVault } from '../store/credentialVault'
import { SettingsStore } from '../store/settingsStore'
import { SessionManager } from '../ssh/sessionManager'
import {
  ChatMessage,
  commandSuggestionMessages,
  connectionDiagnosisMessages,
  explainSelectionMessages,
  sessionSummaryMessages
} from './prompts'

/** API Key 在凭据库中的固定条目 id */
export const AI_KEY_ID = 'ai-provider'
/** 摘要固定读取的滚动缓冲行数 */
export const SUMMARY_LINE_LIMIT = 300
/** 命令建议读取的滚动缓冲行数 */
export const COMMAND_CONTEXT_LINE_LIMIT = 120

const REQUEST_TIMEOUT_MS = 120_000
const TEST_TIMEOUT_MS = 20_000
const MAX_ERROR_BODY = 500

export interface AiServiceDeps {
  settings: SettingsStore
  vault: CredentialVault
  connections: ConnectionStore
  sessions: SessionManager
}

export interface AiEventSink {
  emitChunk(ev: AiChunkEvent): void
  emitDone(ev: AiDoneEvent): void
}

interface ResolvedConfig {
  baseUrl: string
  model: string
  apiKey: string
}

const DONE_MARKER = Symbol('sse-done')

/** 增量解析 SSE：只关心 data 行里的 choices[0].delta.content。 */
export class SseDeltaParser {
  private buffer = ''
  private finished = false

  push(chunk: string): { deltas: string[]; done: boolean } {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    const deltas: string[] = []
    for (const line of lines) {
      const result = this.parseLine(line)
      if (result === DONE_MARKER) {
        this.finished = true
        break
      }
      if (result) deltas.push(result)
    }
    return { deltas, done: this.finished }
  }

  /** 流结束时处理没有换行结尾的最后一行。 */
  flush(): string[] {
    if (this.finished || !this.buffer) return []
    const result = this.parseLine(this.buffer)
    this.buffer = ''
    if (result === DONE_MARKER) {
      this.finished = true
      return []
    }
    return result ? [result] : []
  }

  private parseLine(line: string): string | typeof DONE_MARKER | null {
    if (!line.startsWith('data:')) return null
    const payload = line.slice(5).trim()
    if (!payload) return null
    if (payload === '[DONE]') return DONE_MARKER
    try {
      const parsed = JSON.parse(payload) as {
        choices?: { delta?: { content?: string } }[]
      }
      return parsed.choices?.[0]?.delta?.content || null
    } catch {
      // 部分网关会插入非 JSON 的调试行，忽略即可
      return null
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * AI 只读分析服务：读取配置与密钥、构造提示词、流式调用
 * OpenAI 兼容接口。不提供任何执行能力。
 */
export class AiService {
  private controllers = new Map<string, AbortController>()
  private cancelled = new Set<string>()

  constructor(
    private readonly deps: AiServiceDeps,
    private readonly sink: AiEventSink
  ) {}

  private async getApiKey(): Promise<string | null> {
    const secret = await this.deps.vault.get(AI_KEY_ID)
    return secret?.apiKey ?? null
  }

  private async resolveConfig(): Promise<ResolvedConfig> {
    const settings = await this.deps.settings.get()
    const apiKey = (await this.getApiKey()) ?? ''
    const baseUrl = settings.aiBaseUrl.trim()
    const model = settings.aiModel.trim()
    const missing: string[] = []
    if (!baseUrl) missing.push('服务地址')
    if (!model) missing.push('模型名')
    if (!apiKey) missing.push('API Key（输入后需点击保存）')
    if (missing.length > 0) {
      throw new Error(`AI 配置不完整，缺少：${missing.join('、')}`)
    }
    return { baseUrl, model, apiKey }
  }

  async status(): Promise<AiStatus> {
    const settings = await this.deps.settings.get()
    const apiKey = await this.getApiKey()
    return {
      configured: Boolean(settings.aiBaseUrl.trim() && settings.aiModel.trim() && apiKey),
      keySet: Boolean(apiKey),
      baseUrl: settings.aiBaseUrl,
      model: settings.aiModel
    }
  }

  async setApiKey(apiKey: string | null): Promise<AiStatus> {
    const trimmed = apiKey?.trim()
    if (trimmed) {
      await this.deps.vault.set(AI_KEY_ID, { apiKey: trimmed })
    } else {
      await this.deps.vault.delete(AI_KEY_ID)
    }
    return this.status()
  }

  async test(): Promise<AiTestResult> {
    const started = Date.now()
    try {
      const config = await this.resolveConfig()
      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(new Error('连接测试超时（20 秒）')),
        TEST_TIMEOUT_MS
      )
      try {
        const res = await this.postChat(
          config,
          [{ role: 'user', content: 'ping' }],
          false,
          controller.signal
        )
        await res.text()
        return { ok: true, durationMs: Date.now() - started }
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      return { ok: false, error: errorMessage(err), durationMs: Date.now() - started }
    }
  }

  /**
   * 校验配置与上下文后启动流式请求。校验失败直接抛出（IPC handler
   * 会把它作为 invoke 的 reject 返回给界面）；流式结果通过事件推送。
   */
  async analyze(request: AiAnalysisRequest): Promise<void> {
    const config = await this.resolveConfig()
    const messages = await this.buildMessages(request)
    this.cancelAll()
    const controller = new AbortController()
    this.controllers.set(request.requestId, controller)
    void this.run(request.requestId, config, messages, controller)
  }

  cancel(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (!controller) return
    this.cancelled.add(requestId)
    controller.abort()
  }

  private cancelAll(): void {
    for (const [id, controller] of this.controllers) {
      this.cancelled.add(id)
      controller.abort()
    }
    this.controllers.clear()
  }

  private async run(
    requestId: string,
    config: ResolvedConfig,
    messages: ChatMessage[],
    controller: AbortController
  ): Promise<void> {
    const timer = setTimeout(
      () => controller.abort(new Error('请求超时（120 秒）')),
      REQUEST_TIMEOUT_MS
    )
    try {
      const res = await this.postChat(config, messages, true, controller.signal)
      await this.consume(res, controller.signal, (delta) =>
        this.sink.emitChunk({ requestId, delta })
      )
      this.sink.emitDone({ requestId })
    } catch (err) {
      if (this.cancelled.has(requestId)) {
        this.sink.emitDone({ requestId, cancelled: true })
      } else {
        const reason = controller.signal.aborted ? controller.signal.reason : err
        this.sink.emitDone({ requestId, error: errorMessage(reason) })
      }
    } finally {
      clearTimeout(timer)
      this.controllers.delete(requestId)
      this.cancelled.delete(requestId)
    }
  }

  private async postChat(
    config: ResolvedConfig,
    messages: ChatMessage[],
    stream: boolean,
    signal: AbortSignal
  ): Promise<Response> {
    const base = config.baseUrl.replace(/\/+$/, '')
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({ model: config.model, messages, stream, temperature: 0.2 }),
      signal
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(
        `模型服务返回 ${res.status}${body ? `：${body.slice(0, MAX_ERROR_BODY)}` : ''}`
      )
    }
    return res
  }

  private async consume(
    res: Response,
    signal: AbortSignal,
    onDelta: (delta: string) => void
  ): Promise<void> {
    if (!res.body) throw new Error('模型响应为空')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseDeltaParser()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const parsed = parser.push(decoder.decode(value, { stream: true }))
        parsed.deltas.forEach(onDelta)
        if (parsed.done) return
      }
      parser.flush().forEach(onDelta)
    } finally {
      if (signal.aborted) await reader.cancel().catch(() => {})
    }
  }

  private async connectionMeta(connectionId?: string): Promise<ConnectionMeta | null> {
    if (!connectionId) return null
    const all = await this.deps.connections.listConnections()
    return all.find((c) => c.id === connectionId) ?? null
  }

  private async connectionName(connectionId?: string): Promise<string | undefined> {
    return (await this.connectionMeta(connectionId))?.name
  }

  private async buildMessages(request: AiAnalysisRequest): Promise<ChatMessage[]> {
    switch (request.kind) {
      case 'selection-explanation': {
        const selection = request.selection?.trim()
        if (!selection) throw new Error('没有选中任何内容')
        return explainSelectionMessages(selection, await this.connectionName(request.connectionId))
      }
      case 'session-summary': {
        if (!request.sessionId || !this.deps.sessions.has(request.sessionId)) {
          throw new Error('会话不可用，请重新连接后再试')
        }
        const { lines } = this.deps.sessions.readLines(request.sessionId, SUMMARY_LINE_LIMIT)
        if (lines.length === 0) throw new Error('当前会话还没有终端输出')
        return sessionSummaryMessages(lines, await this.connectionName(request.connectionId))
      }
      case 'connection-diagnosis': {
        const errorMessage = request.errorMessage?.trim()
        if (!errorMessage) throw new Error('缺少错误信息')
        const meta = await this.connectionMeta(request.connectionId)
        return connectionDiagnosisMessages({
          errorMessage,
          connectionName: meta?.name,
          host: meta?.host,
          port: meta?.port,
          username: meta?.username,
          authType: meta?.authType
        })
      }
      case 'command-suggestion': {
        const instruction = request.instruction?.trim()
        if (!instruction) throw new Error('请先描述要做什么')
        if (!request.sessionId || !this.deps.sessions.has(request.sessionId)) {
          throw new Error('会话不可用，请重新连接后再试')
        }
        const { lines } = this.deps.sessions.readLines(
          request.sessionId,
          COMMAND_CONTEXT_LINE_LIMIT
        )
        return commandSuggestionMessages({
          instruction,
          lines,
          connectionName: await this.connectionName(request.connectionId)
        })
      }
      default:
        throw new Error('不支持的 AI 分析类型')
    }
  }
}
